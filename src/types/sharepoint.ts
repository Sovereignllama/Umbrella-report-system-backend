/**
 * SharePoint Graph API Response Types
 */

export interface SharePointListItem {
  id: string;
  name: string;
  webUrl: string;
  parentReference?: {
    driveId: string;
    driveType: string;
  };
}

export interface SharePointDriveItem {
  id: string;
  name: string;
  webUrl: string;
  folder?: {
    childCount: number;
  };
  file?: {
    mimeType: string;
    size: number;
  };
  parentReference?: {
    driveId: string;
    id: string;
  };
}

export interface SharePointUploadSession {
  uploadUrl: string;
  expirationDateTime: string;
  nextExpectedRanges: string[];
}

export interface SharePointFolderStructure {
  projectFolderId: string;
  weekFolderId: string;
  photosFolderId: string;
  weekFolderName: string; // "Jan 1-7"
}

export interface SharePointPermission {
  id: string;
  roles: string[];
  grantedTo: {
    user?: {
      email: string;
      displayName: string;
    };
  };
}

export interface GraphError {
  error: {
    code: string;
    message: string;
  };
}
