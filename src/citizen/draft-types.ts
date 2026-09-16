export interface ExtraApplicantInfo {
  phone: string
  email: string
  address: string
  villageOrTown: string
  district: string
  state: string
  bankAccountNumber: string
  bankIfsc: string
  businessDescription: string
}

export const EMPTY_EXTRA: ExtraApplicantInfo = {
  phone: '',
  email: '',
  address: '',
  villageOrTown: '',
  district: '',
  state: 'Karnataka',
  bankAccountNumber: '',
  bankIfsc: '',
  businessDescription: '',
}
