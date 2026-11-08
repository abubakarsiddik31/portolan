export type WizardData = {
  name: string;
  email: string;
  company: string;
  role: string;
  teamSize: number;
};

export type Submission = {
  id: string;
  sid: string;
  data: WizardData;
  fileName: string;
  fileSize: number;
  submittedAt: string;
};

export type WizardState = {
  step: 1 | 2 | 3;
  data: Partial<WizardData>;
};

export const ROLES = ["Engineer", "Designer", "Product manager", "Operations", "Other"] as const;
