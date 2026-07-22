#!/bin/bash
# Initialize PostgreSQL with proper authentication settings

# Wait for PostgreSQL to start
sleep 2

# Set authentication method to trust for all connections (for development only)
echo "Configuring PostgreSQL authentication..."

# Modify pg_hba.conf to allow all connections with trust method
psql -U postgres <<EOF
ALTER SYSTEM SET password_encryption = 'md5';
EOF

# Use pg_isready to check if postgres is ready
until pg_isready -U postgres; do
  echo 'waiting for postgres...'
  sleep 1
done

echo "PostgreSQL initialization complete"
