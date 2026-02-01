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
let accessToken: string | null = null;
let tokenExpiry: number = 0;

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
 */
async function getGraphClient(): Promise<AxiosInstance> {
  if (!graphClient) {
    const token = await getAccessToken();
    graphClient = axios.create({
      baseURL: GRAPH_API_BASE,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    // Add interceptor to refresh token if it expires
    graphClient.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 401) {
          const token = await getAccessToken();
          graphClient!.defaults.headers.common.Authorization = `Bearer ${token}`;
          return graphClient!(error.config);
        }
        return Promise.reject(error);
      }
    );
  }

  return graphClient;
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
  } catch (error: any) {
    const status = error.response?.status;
    
    // If file is locked, throw specific error
    if (status === 423) {
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
 */
export async function listFilesInFolder(folderPath: string): Promise<SharePointDriveItem[]> {
  try {
    const client = await getGraphClient();
    
    const encodedPath = folderPath.split('/').map(encodeURIComponent).join('/');
    
    const response = await client.get<{ value: SharePointDriveItem[] }>(
      `/drives/${SHAREPOINT_DRIVE_ID}/root:/${encodedPath}:/children`
    );
    
    return response.data.value;
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
 */
export async function readFileByPath(filePath: string): Promise<Buffer> {
  try {
    const client = await getGraphClient();
    
    const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
    
    const response = await client.get(
      `/drives/${SHAREPOINT_DRIVE_ID}/root:/${encodedPath}:/content`,
      {
        responseType: 'arraybuffer',
      }
    );
    
    return Buffer.from(response.data);
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
