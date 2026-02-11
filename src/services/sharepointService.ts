import axios, { AxiosInstance } from 'axios';
import { ClientSecretCredential } from '@azure/identity';
import dotenv from 'dotenv';
import {
  SharePointDriveItem,
  SharePointFolderStructure,
} from '../types/sharepoint';

dotenv.config();

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';
const SHAREPOINT_SITE_URL = process.env.SHAREPOINT_SITE_URL;
const SHAREPOINT_DRIVE_ID = process.env.SHAREPOINT_DRIVE_ID;

// Credential for service account (app-only auth)
let graphClient: AxiosInstance | null = null;
let graphClientPromise: Promise<AxiosInstance> | null = null;
let accessToken: string | null = null;
let tokenExpiry: number = 0;
let graphClientLastUsed: number = 0; // Track last usage time

// Timeout for SharePoint API requests (45 seconds)
const SHAREPOINT_REQUEST_TIMEOUT_MS = 45000;

// Maximum idle time before resetting the client (10 minutes)
const MAX_CLIENT_IDLE_MS = 10 * 60 * 1000;

// In-memory cache for SharePoint responses to avoid repeated slow API calls
interface CacheEntry<T> {
  data: T;
  expiry: number;
}

// Graph API batch request limit - Microsoft Graph supports up to 20 requests per batch
const GRAPH_BATCH_SIZE = 20;

// Interface for Graph API batch response
interface GraphBatchResponse {
  responses: Array<{
    id: string;
    status: number;
    body?: any;
  }>;
}

const sharepointCache = new Map<string, CacheEntry<any>>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// In-flight request deduplication: prevents duplicate concurrent SharePoint API calls
const inflightRequests = new Map<string, Promise<any>>();

function getCached<T>(key: string): T | null {
  const entry = sharepointCache.get(key);
  if (entry && Date.now() < entry.expiry) {
    return entry.data as T;
  }
  if (entry) {
    sharepointCache.delete(key);
  }
  return null;
}

function setCache<T>(key: string, data: T): void {
  sharepointCache.set(key, { data, expiry: Date.now() + CACHE_TTL_MS });
}

/**
 * Clear the SharePoint cache (e.g., after writes/uploads)
 */
export function clearSharePointCache(): void {
  sharepointCache.clear();
}

/**
 * Get access token for Graph API (app-only auth)
 */
async function getAccessToken(): Promise<string> {
  const now = Date.now();

  // Return cached token if still valid
  if (accessToken && now < tokenExpiry) {
    return accessToken;
  }

  try {
    const credential = new ClientSecretCredential(
      process.env.AZURE_TENANT_ID || '',
      process.env.AZURE_CLIENT_ID || '',
      process.env.AZURE_CLIENT_SECRET || ''
    );

    const token = await credential.getToken('https://graph.microsoft.com/.default');
    
    accessToken = token.token;
    // Set expiry to 1 minute before actual expiry for safety
    tokenExpiry = token.expiresOnTimestamp - 60000;

    return token.token;
  } catch (error) {
    console.error('Failed to get access token:', error);
    throw new Error('Failed to authenticate with SharePoint');
  }
}

/**
 * Get or create Graph API client
 * Uses a shared promise to prevent race conditions when multiple
 * concurrent requests try to create the client simultaneously.
 * Resets the client if it has been idle for too long to prevent stale TCP connections.
 */
async function getGraphClient(): Promise<AxiosInstance> {
  const now = Date.now();
  
  // Check if client exists and has been idle for too long
  if (graphClient && graphClientLastUsed > 0) {
    const idleTimeMs = now - graphClientLastUsed;
    if (idleTimeMs > MAX_CLIENT_IDLE_MS) {
      console.log(`♻️  Resetting SharePoint client after ${Math.round(idleTimeMs / 1000 / 60)} minutes of inactivity`);
      graphClient = null;
      graphClientPromise = null;
    }
  }
  
  if (graphClient) {
    // Ensure token is still valid, refresh if needed
    if (now >= tokenExpiry) {
      await getAccessToken();
      graphClient.defaults.headers.common.Authorization = `Bearer ${accessToken}`;
    }
    graphClientLastUsed = now;
    return graphClient;
  }

  // Use a shared promise to prevent multiple concurrent initializations
  if (!graphClientPromise) {
    graphClientPromise = (async () => {
      try {
        const token = await getAccessToken();
        const client = axios.create({
          baseURL: GRAPH_API_BASE,
          timeout: SHAREPOINT_REQUEST_TIMEOUT_MS,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        // Add interceptor to refresh token if it expires
        client.interceptors.response.use(
          (response) => response,
          async (error) => {
            if (error.response?.status === 401) {
              const token = await getAccessToken();
              client.defaults.headers.common.Authorization = `Bearer ${token}`;
              return client(error.config);
            }
            return Promise.reject(error);
          }
        );

        graphClient = client;
        graphClientLastUsed = Date.now();
        return client;
      } finally {
        graphClientPromise = null;
      }
    })();
  }

  return graphClientPromise;
}

/**
 * Initialize SharePoint integration
 */
export async function initializeSharePoint(): Promise<void> {
  try {
    if (!SHAREPOINT_SITE_URL || !SHAREPOINT_DRIVE_ID) {
      throw new Error('SHAREPOINT_SITE_URL and SHAREPOINT_DRIVE_ID must be configured');
    }

    // Verify client can be created (validates credentials)
    await getGraphClient();
    console.log('✅ SharePoint integration initialized');
  } catch (error) {
    console.error('❌ Failed to initialize SharePoint:', error);
    throw error;
  }
}

/**
 * Create a folder in SharePoint
 * @param parentFolderId - ID of parent folder (or ':root:' for drive root)
 * @param folderName - Name of folder to create
 * @returns Folder ID and web URL
 */
export async function createFolder(
  parentFolderId: string,
  folderName: string
): Promise<{ folderId: string; webUrl: string }> {
  try {
    const client = await getGraphClient();

    const response = await client.post<SharePointDriveItem>(
      `/drives/${SHAREPOINT_DRIVE_ID}/items/${parentFolderId}/children`,
      {
        name: folderName,
        folder: {},
        '@microsoft.graph.conflictBehavior': 'rename',
      }
    );

    clearSharePointCache();
    return {
      folderId: response.data.id,
      webUrl: response.data.webUrl,
    };
  } catch (error) {
    console.error(`Failed to create folder "${folderName}":`, error);
    throw new Error(`Failed to create folder: ${folderName}`);
  }
}

/**
 * Get or create folder (returns existing if found)
 */
export async function getOrCreateFolder(
  parentFolderId: string,
  folderName: string
): Promise<{ folderId: string; webUrl: string }> {
  try {
    const client = await getGraphClient();

    // Get all children and filter in code (Graph API doesn't support folder filter well)
    const searchResponse = await client.get<{ value: SharePointDriveItem[] }>(
      `/drives/${SHAREPOINT_DRIVE_ID}/items/${parentFolderId}/children`
    );

    // Find existing folder by name
    const existingFolder = searchResponse.data.value.find(
      item => item.name.toLowerCase() === folderName.toLowerCase() && item.folder
    );

    if (existingFolder) {
      return {
        folderId: existingFolder.id,
        webUrl: existingFolder.webUrl,
      };
    }

    // Create if doesn't exist
    return createFolder(parentFolderId, folderName);
  } catch (error) {
    console.error(`Failed to get or create folder "${folderName}":`, error);
    throw error;
  }
}

/**
 * Create project folder structure in SharePoint
 * Structure:
 * projects/
 *   ├─ ProjectName/
 *   │  ├─ Archive/
 *   │  └─ photos/
 */
export async function createProjectFolderStructure(
  projectName: string
): Promise<{ projectFolderId: string; projectWebUrl: string }> {
  try {
    // Find or create "projects" root folder
    const projectsRoot = await getOrCreateFolder(':root:', 'projects');

    // Create project folder
    const projectFolder = await createFolder(projectsRoot.folderId, projectName);

    // Create Archive folder
    await createFolder(projectFolder.folderId, 'Archive');

    // Create photos folder (will be under week folders later)
    // Not created here - will be created per week

    return {
      projectFolderId: projectFolder.folderId,
      projectWebUrl: projectFolder.webUrl,
    };
  } catch (error) {
    console.error(`Failed to create project folder structure for "${projectName}":`, error);
    throw error;
  }
}

/**
 * Create week folder structure for a project
 * Structure:
 * projects/ProjectName/
 *   ├─ Jan 1-7/
 *   │  ├─ photos/
 *   │  └─ [Excel files]
 */
export async function createWeekFolderStructure(
  projectFolderId: string,
  weekRange: string // "Jan 1-7"
): Promise<SharePointFolderStructure> {
  try {
    // Create week folder
    const weekFolder = await createFolder(projectFolderId, weekRange);

    // Create photos subfolder
    const photosFolder = await createFolder(weekFolder.folderId, 'photos');

    return {
      projectFolderId,
      weekFolderId: weekFolder.folderId,
      photosFolderId: photosFolder.folderId,
      weekFolderName: weekRange,
    };
  } catch (error) {
    console.error(`Failed to create week folder structure for "${weekRange}":`, error);
    throw error;
  }
}

/**
 * Upload file to SharePoint
 * @param folderId - ID of destination folder
 * @param fileName - Name of file to create/overwrite
 * @param fileContent - Buffer or string content
 * @returns Web URL of uploaded file
 */
export async function uploadFile(
  folderId: string,
  fileName: string,
  fileContent: Buffer | string
): Promise<{ fileId: string; webUrl: string }> {
  try {
    const client = await getGraphClient();

    const buffer = typeof fileContent === 'string' 
      ? Buffer.from(fileContent, 'utf-8') 
      : fileContent;

    const response = await client.put<SharePointDriveItem>(
      `/drives/${SHAREPOINT_DRIVE_ID}/items/${folderId}:/${encodeURIComponent(fileName)}:/content`,
      buffer,
      {
        headers: {
          'Content-Type': 'application/octet-stream',
        },
      }
    );

    clearSharePointCache();
    return {
      fileId: response.data.id,
      webUrl: response.data.webUrl,
    };
  } catch (error) {
    console.error(`Failed to upload file "${fileName}":`, error);
    throw new Error(`Failed to upload file: ${fileName}`);
  }
}

/**
 * Upload large file using resumable upload
 * For files > 4MB
 */
export async function uploadLargeFile(
  folderId: string,
  fileName: string,
  fileBuffer: Buffer
): Promise<{ fileId: string; webUrl: string }> {
  try {
    const client = await getGraphClient();
    const chunkSize = 320 * 1024; // 320KB chunks

    // Create upload session
    const sessionResponse = await client.post(
      `/drives/${SHAREPOINT_DRIVE_ID}/items/${folderId}:/${encodeURIComponent(fileName)}:/createUploadSession`,
      {
        item: {
          '@microsoft.graph.conflictBehavior': 'replace',
        },
      }
    );

    const uploadUrl = sessionResponse.data.uploadUrl;

    // Upload in chunks
    let uploadedBytes = 0;
    while (uploadedBytes < fileBuffer.length) {
      const chunk = fileBuffer.slice(
        uploadedBytes,
        uploadedBytes + chunkSize
      );

      const contentRange = `bytes ${uploadedBytes}-${uploadedBytes + chunk.length - 1}/${fileBuffer.length}`;

      const chunkResponse = await axios.put(uploadUrl, chunk, {
        headers: {
          'Content-Range': contentRange,
          'Content-Length': chunk.length,
        },
      });

      if (chunkResponse.status === 201 || chunkResponse.status === 200) {
        const item = chunkResponse.data as SharePointDriveItem;
        clearSharePointCache();
        return {
          fileId: item.id,
          webUrl: item.webUrl,
        };
      }

      uploadedBytes += chunk.length;
    }

    throw new Error('Upload session did not complete');
  } catch (error) {
    console.error(`Failed to upload large file "${fileName}":`, error);
    throw new Error(`Failed to upload file: ${fileName}`);
  }
}

/**
 * Archive old report by moving to Archive folder
 * Optionally rename the file during the move
 */
export async function archiveFile(
  fileId: string,
  archiveFolderId: string,
  newFileName?: string
): Promise<void> {
  try {
    const client = await getGraphClient();

    const patchBody: any = {
      parentReference: {
        id: archiveFolderId,
      },
    };
    
    // Optionally rename the file
    if (newFileName) {
      patchBody.name = newFileName;
    }

    await client.patch(
      `/drives/${SHAREPOINT_DRIVE_ID}/items/${fileId}`,
      patchBody
    );
    clearSharePointCache();
  } catch (error: any) {
    const status = error.response?.status;
    const errorCode = error.response?.data?.error?.code;
    
    // If file is locked (423), throw FILE_LOCKED error
    if (status === 423) {
      console.error(`File locked (status ${status}):`, error.response?.data);
      throw new Error('FILE_LOCKED');
    }
    
    // If 409 with nameAlreadyExists, this is a naming conflict not a lock
    if (status === 409 && errorCode === 'nameAlreadyExists') {
      console.error('Archive naming conflict:', error.response?.data);
      throw new Error('NAME_CONFLICT');
    }
    
    // If 409 without nameAlreadyExists, it might be a file lock
    if (status === 409) {
      console.error(`File conflict (status ${status}):`, error.response?.data);
      throw new Error('FILE_LOCKED');
    }
    
    console.error('Failed to archive file:', error);
    throw new Error('Failed to archive file');
  }
}

/**
 * Rename a file in SharePoint (without moving it)
 */
export async function renameFile(
  fileId: string,
  newFileName: string
): Promise<void> {
  try {
    const client = await getGraphClient();

    await client.patch(
      `/drives/${SHAREPOINT_DRIVE_ID}/items/${fileId}`,
      { name: newFileName }
    );
    clearSharePointCache();
  } catch (error) {
    console.error('Failed to rename file:', error);
    throw new Error('Failed to rename file');
  }
}

/**
 * Delete file from SharePoint
 */
export async function deleteFile(fileId: string): Promise<void> {
  try {
    const client = await getGraphClient();
    await client.delete(`/drives/${SHAREPOINT_DRIVE_ID}/items/${fileId}`);
    clearSharePointCache();
  } catch (error) {
    console.error('Failed to delete file:', error);
    throw new Error('Failed to delete file');
  }
}

/**
 * Get file from SharePoint
 */
export async function getFile(fileId: string): Promise<Buffer> {
  try {
    const client = await getGraphClient();

    const response = await client.get(
      `/drives/${SHAREPOINT_DRIVE_ID}/items/${fileId}/content`,
      {
        responseType: 'arraybuffer',
      }
    );

    return Buffer.from(response.data);
  } catch (error) {
    console.error('Failed to get file:', error);
    throw new Error('Failed to get file');
  }
}

/**
 * Validate SharePoint configuration
 */
export async function validateSharePointConfig(): Promise<boolean> {
  try {
    if (!SHAREPOINT_SITE_URL || !SHAREPOINT_DRIVE_ID) {
      console.error('SharePoint configuration missing');
      return false;
    }

    const client = await getGraphClient();
    // Test connection by querying the drive
    await client.get(`/drives/${SHAREPOINT_DRIVE_ID}`);

    console.log('✅ SharePoint configuration valid');
    return true;
  } catch (error) {
    console.error('❌ SharePoint configuration invalid:', error);
    return false;
  }
}

/**
 * Get folder by path (e.g., "Documents/Umbrella Report Config/site_employees")
 */
export async function getFolderByPath(folderPath: string): Promise<SharePointDriveItem | null> {
  try {
    const client = await getGraphClient();
    
    // Graph API uses : to indicate path-based access
    // Format: /drives/{drive-id}/root:/{path}
    const encodedPath = folderPath.split('/').map(encodeURIComponent).join('/');
    
    const response = await client.get<SharePointDriveItem>(
      `/drives/${SHAREPOINT_DRIVE_ID}/root:/${encodedPath}`
    );
    
    return response.data;
  } catch (error: any) {
    if (error.response?.status === 404) {
      return null;
    }
    console.error(`Failed to get folder at path "${folderPath}":`, error);
    throw error;
  }
}

/**
 * List files in a folder by path
 * Uses in-flight deduplication to prevent duplicate concurrent API calls
 */
export async function listFilesInFolder(folderPath: string): Promise<SharePointDriveItem[]> {
  try {
    const cacheKey = `listFiles:${folderPath}`;
    const cached = getCached<SharePointDriveItem[]>(cacheKey);
    if (cached) {
      return cached;
    }

    // Deduplicate concurrent in-flight requests for the same folder
    const inflight = inflightRequests.get(cacheKey);
    if (inflight) {
      return inflight;
    }

    const request = (async () => {
      try {
        const client = await getGraphClient();
        
        const encodedPath = folderPath.split('/').map(encodeURIComponent).join('/');
        
        const response = await client.get<{ value: SharePointDriveItem[] }>(
          `/drives/${SHAREPOINT_DRIVE_ID}/root:/${encodedPath}:/children`
        );
        
        setCache(cacheKey, response.data.value);
        return response.data.value;
      } finally {
        inflightRequests.delete(cacheKey);
      }
    })();

    inflightRequests.set(cacheKey, request);
    return request;
  } catch (error: any) {
    if (error.response?.status === 404) {
      console.warn(`Folder not found: ${folderPath}`);
      return [];
    }
    console.error(`Failed to list files in "${folderPath}":`, error);
    throw error;
  }
}

/**
 * Read file content by path
 * Uses in-flight deduplication to prevent duplicate concurrent API calls
 */
export async function readFileByPath(filePath: string): Promise<Buffer> {
  try {
    const cacheKey = `readFile:${filePath}`;
    const cached = getCached<Buffer>(cacheKey);
    if (cached) {
      return Buffer.from(cached);
    }

    // Deduplicate concurrent in-flight requests for the same file
    const inflight = inflightRequests.get(cacheKey);
    if (inflight) {
      const result = await inflight;
      return Buffer.from(result);
    }

    const request = (async () => {
      try {
        const client = await getGraphClient();
        
        const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
        
        const response = await client.get(
          `/drives/${SHAREPOINT_DRIVE_ID}/root:/${encodedPath}:/content`,
          {
            responseType: 'arraybuffer',
          }
        );
        
        const buffer = Buffer.from(response.data);
        setCache(cacheKey, buffer);
        return buffer;
      } finally {
        inflightRequests.delete(cacheKey);
      }
    })();

    inflightRequests.set(cacheKey, request);
    const result = await request;
    return Buffer.from(result);
  } catch (error) {
    console.error(`Failed to read file at "${filePath}":`, error);
    throw new Error(`Failed to read file: ${filePath}`);
  }
}

/**
 * Read JSON file from SharePoint by path
 */
export async function readJsonFileByPath<T = any>(filePath: string): Promise<T> {
  const buffer = await readFileByPath(filePath);
  const content = buffer.toString('utf-8');
  return JSON.parse(content);
}

/**
 * Validate sheet name for Graph API safety
 */
function validateSheetName(sheetName: string): void {
  if (sheetName.includes("'") || sheetName.includes('"')) {
    throw new Error(`Sheet name cannot contain quote characters: ${sheetName}`);
  }
}

/**
 * Validate Excel range address format
 */
function validateRangeAddress(rangeAddress: string): void {
  // Range addresses should follow Excel format (e.g., A1, B2:C10)
  if (!/^[A-Z]+\d+(:[A-Z]+\d+)?$/i.test(rangeAddress)) {
    throw new Error(`Invalid Excel range address format (expected A1 or A1:B2): ${rangeAddress}`);
  }
}

/**
 * Build Graph API URL for Excel workbook range operations
 */
function buildWorkbookRangeUrl(itemId: string, sheetName: string, rangeAddress: string): string {
  // Validate inputs to prevent potential injection issues
  validateSheetName(sheetName);
  validateRangeAddress(rangeAddress);
  
  // For Graph Workbooks API, sheet names and range addresses are passed as string parameters
  // within the function syntax - they should not be URL-encoded
  return `/drives/${SHAREPOINT_DRIVE_ID}/items/${encodeURIComponent(itemId)}/workbook/worksheets('${sheetName}')/range(address='${rangeAddress}')`;
}

/**
 * Get file item ID by path (needed for Graph Workbooks API)
 */
export async function getFileItemId(filePath: string): Promise<string | null> {
  try {
    const client = await getGraphClient();
    const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
    
    const response = await client.get<SharePointDriveItem>(
      `/drives/${SHAREPOINT_DRIVE_ID}/root:/${encodedPath}`
    );
    
    return response.data.id;
  } catch (error: any) {
    if (error.response?.status === 404) {
      return null;
    }
    console.error(`Failed to get file item ID for "${filePath}":`, error);
    throw error;
  }
}

/**
 * Read a range of cells from an Excel workbook via Graph Workbooks API
 */
export async function readExcelRange(
  itemId: string,
  sheetName: string,
  rangeAddress: string
): Promise<any[][]> {
  try {
    const client = await getGraphClient();
    const url = buildWorkbookRangeUrl(itemId, sheetName, rangeAddress);
    const response = await client.get(url);
    
    return response.data.values || [];
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Failed to read range ${rangeAddress} from sheet '${sheetName}':`, error);
    throw new Error(`Failed to read Excel range ${rangeAddress} from sheet '${sheetName}': ${errorMsg}`);
  }
}

/**
 * Update a range of cells in an Excel workbook via Graph Workbooks API
 * This does NOT replace the file — it only updates the specified cells
 */
export async function updateExcelRange(
  itemId: string,
  sheetName: string,
  rangeAddress: string,
  values: any[][]
): Promise<void> {
  try {
    const client = await getGraphClient();
    const url = buildWorkbookRangeUrl(itemId, sheetName, rangeAddress);
    await client.patch(url, { values });
    
    clearSharePointCache();
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Failed to update range ${rangeAddress} in sheet '${sheetName}':`, error);
    throw new Error(`Failed to update Excel range ${rangeAddress} in sheet '${sheetName}': ${errorMsg}`);
  }
}

/**
 * Batch update multiple ranges in an Excel workbook
 * Groups updates into batches of up to 20 requests each
 */
export async function batchUpdateExcelRanges(
  itemId: string,
  updates: Array<{
    sheetName: string;
    rangeAddress: string;
    values: any[][];
  }>
): Promise<void> {
  try {
    const client = await getGraphClient();
    
    // Pre-validate itemId once
    const encodedItemId = encodeURIComponent(itemId);
    
    // Process updates in batches
    for (let i = 0; i < updates.length; i += GRAPH_BATCH_SIZE) {
      const batch = updates.slice(i, i + GRAPH_BATCH_SIZE);
      
      // Pre-validate all sheet names and range addresses in this batch
      for (const update of batch) {
        validateSheetName(update.sheetName);
        validateRangeAddress(update.rangeAddress);
      }
      
      // Build batch requests using the same URL construction as buildWorkbookRangeUrl
      let batchRequests = batch.map((update, idx) => {
        const sheetUrl = `/drives/${SHAREPOINT_DRIVE_ID}/items/${encodedItemId}/workbook/worksheets('${update.sheetName}')/range(address='${update.rangeAddress}')`;
        return {
          id: String(idx + 1),
          method: 'PATCH',
          url: sheetUrl,
          headers: { 'Content-Type': 'application/json' },
          body: { values: update.values }
        };
      });
      
      // Retry configuration
      const MAX_RETRIES = 3;
      const BASE_DELAY_MS = 2000; // Start with 2 seconds
      let retryCount = 0;
      let requestsToSend = batchRequests;
      
      while (true) {
        // Send batch request
        const response = await client.post<GraphBatchResponse>('/$batch', {
          requests: requestsToSend
        });
        
        // Check for individual request failures
        if (response.data.responses) {
          const failures = response.data.responses.filter(r => r.status >= 400);
          
          if (failures.length > 0) {
            // Separate retryable (429, 503) from non-retryable failures
            const retryableFailures = failures.filter(f => f.status === 429 || f.status === 503);
            const nonRetryableFailures = failures.filter(f => f.status !== 429 && f.status !== 503);
            
            // If there are non-retryable failures, fail immediately
            if (nonRetryableFailures.length > 0) {
              const failureDetails = nonRetryableFailures.map(f => {
                const errorBody = f.body?.error?.message || JSON.stringify(f.body);
                return `  Request #${f.id}: HTTP ${f.status} - ${errorBody}`;
              }).join('\n');
              console.error('Batch request failures:\n' + failureDetails);
              throw new Error(`Batch update had ${nonRetryableFailures.length} non-retryable failures:\n${failureDetails}`);
            }
            
            // Handle retryable failures
            if (retryableFailures.length > 0) {
              if (retryCount >= MAX_RETRIES) {
                // Exhausted retries
                const failureDetails = retryableFailures.map(f => {
                  const errorBody = f.body?.error?.message || JSON.stringify(f.body);
                  return `  Request #${f.id}: HTTP ${f.status} - ${errorBody}`;
                }).join('\n');
                console.error(`Batch request failures after ${retryCount} retries:\n` + failureDetails);
                throw new Error(`Batch update had ${retryableFailures.length} failures after ${retryCount} retries:\n${failureDetails}`);
              }
              
              // Extract Retry-After header if present
              let delayMs = BASE_DELAY_MS * Math.pow(2, retryCount);
              const retryAfterValues = retryableFailures
                .map(f => {
                  const headers = f.body?.headers || {};
                  return headers['Retry-After'] || headers['retry-after'];
                })
                .filter(v => v !== undefined);
              
              if (retryAfterValues.length > 0) {
                // Use the maximum Retry-After value if multiple are present
                const maxRetryAfter = Math.max(...retryAfterValues.map(v => {
                  const parsed = parseInt(v, 10);
                  return isNaN(parsed) ? 0 : parsed;
                }));
                if (maxRetryAfter > 0) {
                  delayMs = maxRetryAfter * 1000; // Convert seconds to milliseconds
                }
              }
              
              retryCount++;
              console.warn(`Retrying ${retryableFailures.length} failed requests (attempt ${retryCount}/${MAX_RETRIES}) after ${delayMs}ms delay`);
              
              // Wait before retrying
              await new Promise(resolve => setTimeout(resolve, delayMs));
              
              // Rebuild batch with only the failed requests
              const failedIds = new Set(retryableFailures.map(f => f.id));
              requestsToSend = batchRequests.filter(req => failedIds.has(req.id));
              
              continue; // Retry the loop
            }
          }
        }
        
        // Success - all requests completed
        break;
      }
      
      console.log(`Batch update completed: ${batch.length} ranges updated`);
    }
    
    clearSharePointCache();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Failed to batch update Excel ranges:', error);
    throw new Error(`Failed to batch update Excel ranges: ${errorMessage}`);
  }
}
