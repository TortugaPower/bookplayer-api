# Apple Root Certificates

This directory should contain Apple root certificates for verifying JWS signatures from Apple's App Store Server API.

## Docker/ECS Deployment

The Dockerfile automatically downloads the Apple root certificate during the build process. No manual setup is required for production deployments.

## Local Development Setup

For local development, you need to manually download the certificate:

1. Download `AppleRootCA-G3.cer` from: https://www.apple.com/certificateauthority/AppleRootCA-G3.cer

2. Place the downloaded file in this directory (`certs/AppleRootCA-G3.cer`)

Or use curl:
```bash
curl -fsSL https://www.apple.com/certificateauthority/AppleRootCA-G3.cer -o certs/AppleRootCA-G3.cer
```

## How It Works

The `RetentionMessagingService` automatically loads all `.cer` files from this directory at runtime to verify JWS signatures from Apple's Retention Messaging API.

## Security Note

The `.cer` files are public root certificates from Apple and are safe to include in deployments. They are excluded from git (via `.gitignore`) to ensure certificates are always downloaded fresh from Apple's official source.
