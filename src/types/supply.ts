export type PartnerProfileStatus =
  | 'not_applied'
  | 'draft'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'suspended';

export type CapabilityType =
  | 'field_service'
  | 'delivery'
  | 'driver'
  | 'mover'
  | 'remote_service';

export type CapabilityStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export type PartnerApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'pending_review'
  | 'approved'
  | 'rejected';

export type AvailabilityStatus = 'available' | 'busy' | 'offline';

export type PartnerDocumentType =
  | 'aadhaar'
  | 'pan'
  | 'dl'
  | 'rc'
  | 'insurance'
  | 'police_verification'
  | 'experience_letter'
  | 'portfolio'
  | 'certificate';

export type DocumentVerificationStatus = 'pending' | 'verified' | 'rejected';

export type SupplyProgram = 'marketplace' | 'book_now';

export interface PartnerProfile {
  status: PartnerProfileStatus;
  approvedAt?: Date;
  approvedBy?: string;
  onboardingCompleted: boolean;
  languages: string[];
  gender?: string;
  dob?: Date;
}
