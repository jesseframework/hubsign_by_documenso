#!/bin/bash

echo "🚀 Starting HubSign application..."

# Create certificate file from environment variable if provided
if [ ! -z "$NEXT_PRIVATE_SIGNING_LOCAL_FILE_CONTENTS" ]; then
    echo "📋 Creating certificate file from environment variable..."
    # Create the certificate file from base64 content
    echo "$NEXT_PRIVATE_SIGNING_LOCAL_FILE_CONTENTS" | base64 -d > /app/certs/signing-cert.p12
    
    # Set the file path environment variable
    export NEXT_PRIVATE_SIGNING_LOCAL_FILE_PATH="/app/certs/signing-cert.p12"
    
    # Verify the file was created
    if [ -f "/app/certs/signing-cert.p12" ]; then
        echo "✅ Certificate file created at: $NEXT_PRIVATE_SIGNING_LOCAL_FILE_PATH"
        echo "📊 Certificate file size: $(stat -c%s /app/certs/signing-cert.p12) bytes"
    else
        echo "❌ Failed to create certificate file"
    fi
else
    echo "⚠️  No certificate content provided in NEXT_PRIVATE_SIGNING_LOCAL_FILE_CONTENTS"
fi

# Change to app directory
cd /app

echo "🔄 Running Prisma migrations..."
npx prisma migrate deploy --schema ./packages/prisma/schema.prisma
echo "✅ Prisma migrations completed"

# Change to remix app directory
cd apps/remix

echo "🚀 Starting HubSign server on 0.0.0.0:3000..."
echo "🔧 Environment check:"
echo "  - NEXT_PRIVATE_SIGNING_TRANSPORT: $NEXT_PRIVATE_SIGNING_TRANSPORT"
echo "  - NEXT_PRIVATE_SIGNING_LOCAL_FILE_PATH: $NEXT_PRIVATE_SIGNING_LOCAL_FILE_PATH" 
echo "  - NEXT_PRIVATE_SIGNING_PASSPHRASE: [SET]"

exec node build/server/main.js