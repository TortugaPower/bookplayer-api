import type {
  AuthenticatorTransportFuture,
  CredentialDeviceType,
} from '@simplewebauthn/types';

export interface PasskeyCredential {
  id_passkey: number;
  auth_method_id: number;
  credential_id: Buffer;
  public_key: Buffer;
  counter: number;
  device_type: CredentialDeviceType;
  backed_up: boolean;
  transports: AuthenticatorTransportFuture[];
  device_name: string | null;
  last_used_at: Date | null;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface AuthMethod {
  id_auth_method: number;
  user_id: number;
  auth_type: 'apple' | 'passkey';
  external_id: string;
  metadata: Record<string, unknown>;
  is_primary: boolean;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface WebAuthnChallenge {
  id_challenge: number;
  challenge: Buffer;
  user_id: number | null;
  email: string | null;
  challenge_type: 'registration' | 'authentication';
  expires_at: Date;
  created_at: Date;
}

export interface PasskeyRegistrationOptionsRequest {
  email: string;
  device_name?: string;
}

export interface PasskeyRegistrationOptionsResponse {
  challenge: string;
  user_id: string;
  rp_id: string;
  rp_name: string;
  timeout: number;
  user_name: string;
  user_display_name: string;
  exclude_credentials: Array<{
    id: string;
    type: 'public-key';
    transports?: AuthenticatorTransportFuture[];
  }>;
}

export interface PasskeyRegistrationVerifyRequest {
  email: string;
  credential_id: string;
  raw_id: string;
  response: {
    attestation_object: string;
    client_data_json: string;
    transports?: AuthenticatorTransportFuture[];
  };
  device_name?: string;
}

export interface PasskeyAuthOptionsResponse {
  challenge: string;
  timeout: number;
  rp_id: string;
  allow_credentials?: Array<{
    id: string;
    type: 'public-key';
    transports?: AuthenticatorTransportFuture[];
  }>;
}

export interface PasskeyAuthVerifyRequest {
  credential_id: string;
  raw_id: string;
  response: {
    authenticator_data: string;
    client_data_json: string;
    signature: string;
    user_handle?: string;
  };
}

export interface PasskeyLoginResponse {
  email: string;
  token: string;
  public_id: string;
}

export interface PasskeyInfo {
  id_passkey: number;
  device_name: string | null;
  device_type: CredentialDeviceType;
  backed_up: boolean;
  last_used_at: Date | null;
  created_at: Date;
}

export interface UserWithPublicId {
  id_user: number;
  email: string;
  public_id: string;
  active: boolean;
  session?: string;
  params?: Record<string, unknown>;
}
