// Database types
export interface Client {
  id: string;
  name: string;
  sharePointFolderId?: string;
  active: boolean;
  createdAt: Date;
}

export interface Project {
  id: string;
  clientId?: string;
  name: string;
  active: boolean;
  sharePointFolderId: string;
  sharePointWebUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Employee {
  id: string;
  name: string;
  qbId?: string; // QuickBooks ID
  skillLevel: string; // e.g., 'Junior', 'Senior', 'Lead'
  active: boolean;
  importedAt: Date;
}

export interface ChargeOutRate {
  id: string;
  clientId?: string; // Optional: for client-specific rates
  skillLevel: string;
  regularRate: number;
  otRate: number;
  dtRate: number;
  effectiveDate: Date;
  active: boolean;
}

export interface Equipment {
  id: string;
  name: string;
  active: boolean;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'supervisor' | 'boss';
  active: boolean;
  assignedBy?: string;
  assignedDate?: Date;
  createdAt: Date;
}

export interface DailyReport {
  id: string;
  projectId: string;
  clientName?: string;
  projectName?: string;
  weekFolder?: string;
  reportDate: Date;
  supervisorId: string;
  notes: string;
  materials?: string;
  status: 'submitted' | 'archived';
  excelSupervisorUrl?: string;
  excelBossUrl?: string;
  createdAt: Date;
  updatedAt: Date;
  overriddenFrom?: string; // ID of previous report if this is an override
}

export interface ReportLaborLine {
  id: string;
  reportId: string;
  employeeId: string;
  regularHours: number;
  otHours: number;
  dtHours: number;
  workDescription: string;
}

export interface ReportEquipmentLine {
  id: string;
  reportId: string;
  equipmentId: string;
  hoursUsed: number;
}

export interface ReportMaterials {
  id: string;
  reportId: string;
  freeTextNotes: string;
}

export interface ReportAttachment {
  id: string;
  reportId: string;
  sharePointUrl: string;
  fileName: string;
  uploadedDate: Date;
}

export interface TemplateVersion {
  id: string;
  name: string; // 'SupervisorReport', 'BossReport'
  version: string; // e.g., 'v1.2'
  sharePointUrl: string;
  createdAt: Date;
  active: boolean;
}

export interface PayPeriod {
  id: string;
  year: number;
  periodNumber: number;
  startDate: Date;
  endDate: Date;
  reportGenerated: boolean;
  reportGeneratedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
