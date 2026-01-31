import {
  createProjectFolderStructure,
  uploadFile,
  getOrCreateFolder,
} from './sharepointService';
import { getWeekRangeForDate, generateReportFileName } from '../utils/weekUtils';
import { ProjectRepository } from '../repositories';

/**
 * Ensure project has SharePoint folder structure
 * Creates if not exists, returns folder ID
 */
export async function ensureProjectFolders(projectId: string): Promise<string> {
  const project = await ProjectRepository.findById(projectId);

  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  // If already has folder, return it
  if (project.sharePointFolderId) {
    return project.sharePointFolderId;
  }

  // Create folder structure
  const { projectFolderId } = await createProjectFolderStructure(project.name);

  // Update project with folder ID
  await ProjectRepository.update(projectId, {
    sharePointFolderId: projectFolderId,
  });

  return projectFolderId;
}

/**
 * Ensure week folder exists for project
 */
export async function ensureWeekFolder(
  projectFolderId: string,
  reportDate: Date
): Promise<{
  weekFolderId: string;
  weekFolderName: string;
  photosFolderId: string;
}> {
  const weekRange = getWeekRangeForDate(reportDate);

  // Check if week folder exists
  const existing = await getOrCreateFolder(
    projectFolderId,
    weekRange.folderName
  );

  // Get or create photos folder
  const photos = await getOrCreateFolder(existing.folderId, 'photos');

  return {
    weekFolderId: existing.folderId,
    weekFolderName: weekRange.folderName,
    photosFolderId: photos.folderId,
  };
}

/**
 * Upload report Excel file
 */
export async function uploadReportFile(
  weekFolderId: string,
  projectName: string,
  reportDate: Date,
  excelBuffer: Buffer,
  reportType: 'supervisor' | 'boss'
): Promise<{ fileId: string; webUrl: string }> {
  const fileName = generateReportFileName(projectName, reportDate, reportType);

  return uploadFile(weekFolderId, fileName, excelBuffer);
}

/**
 * Archive previous report if overriding
 */
export async function archivePreviousReport(
  projectFolderId: string,
  previousReportUrl: string
): Promise<void> {
  try {
    // Extract folder ID from SharePoint URL
    // URL format: https://tenant.sharepoint.com/sites/site/Shared Documents/...
    // This is a simplified version - you may need to parse the URL differently
    // based on your SharePoint setup

    // Get Archive folder (will be used when we implement actual file moving)
    await getOrCreateFolder(projectFolderId, 'Archive');

    // In production, you'd extract the file ID from the URL and move it
    // For now, this is a placeholder
    console.log(`Would archive report: ${previousReportUrl}`);
  } catch (error) {
    console.error('Failed to archive previous report:', error);
    // Don't fail the whole operation if archiving fails
  }
}

/**
 * Upload photo attachment
 */
export async function uploadPhotoAttachment(
  photosFolderId: string,
  photoBuffer: Buffer,
  fileName: string
): Promise<{ fileId: string; webUrl: string }> {
  return uploadFile(photosFolderId, fileName, photoBuffer);
}

/**
 * Get SharePoint folder for boss-only priced reports
 * Creates dedicated boss folder if doesn't exist
 */
export async function getBossFolderStructure(): Promise<{
  bossFolderId: string;
  bossFolderWebUrl: string;
}> {
  const bossFolder = await getOrCreateFolder(':root:', 'Boss Reports');

  return {
    bossFolderId: bossFolder.folderId,
    bossFolderWebUrl: bossFolder.webUrl,
  };
}

/**
 * Upload boss Excel (priced view)
 */
export async function uploadBossReport(
  excelBuffer: Buffer,
  projectName: string,
  reportDate: Date
): Promise<{ fileId: string; webUrl: string }> {
  const { bossFolderId } = await getBossFolderStructure();

  const fileName = generateReportFileName(projectName, reportDate, 'boss');

  return uploadFile(bossFolderId, fileName, excelBuffer);
}
