declare module 'cookie' {
  export interface CookieSerializeOptions {
    domain?: string;
    encode?(value: string): string;
    expires?: Date;
    httpOnly?: boolean;
    maxAge?: number;
    path?: string;
    priority?: 'low' | 'medium' | 'high';
    sameSite?: boolean | 'lax' | 'strict' | 'none';
    secure?: boolean;
    partitioned?: boolean;
  }

  export interface CookieParseOptions {
    decode?(value: string): string;
  }

  export function parse(str: string, options?: CookieParseOptions): Record<string, string>;
  export function serialize(name: string, value: string, options?: CookieSerializeOptions): string;
}
