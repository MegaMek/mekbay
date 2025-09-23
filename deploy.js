const SftpClient = require('ssh2-sftp-client');
const path = require('path');
const fs = require('fs');

// --- Configuration ---
// Path to the SFTP configuration file
const configPath = path.join(__dirname, '.vscode', 'sftp.json');
// Path to the local directory to upload (Angular's default build output)
const localPath = path.join(__dirname, 'dist', 'browser');
// --- End Configuration ---

async function main() {
  if (!fs.existsSync(configPath)) {
    console.error(`❌ Error: Configuration file not found at ${configPath}`);
    console.error('Please create it with your SFTP server details.');
    process.exit(1);
  }

  if (!fs.existsSync(localPath)) {
    console.error(`❌ Error: Build directory not found at ${localPath}`);
    console.error('Please run "npm run build" before deploying.');
    process.exit(1);
  }

  // Read and parse the SFTP configuration, we expect it to be an array of configs, we take the first one
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))[0];
  if (!config || !config.host || !config.username || !config.password || !config.remotePath) {
    console.error('❌ Error: Invalid SFTP configuration. Please ensure it contains host, username, password, and remotePath.');
    process.exit(1);
  }
  const sftp = new SftpClient();

  try {
    console.log(`🚀 Connecting to ${config.host}...`);
    await sftp.connect({
      host: config.host,
      port: config.port || 22,
      username: config.username,
      password: config.password, // For production, consider using 'privateKey'
    });

    console.log(`🧹 Cleaning remote directory: ${config.remotePath}, preserving 'db' folder...`);

    // Ensure the remote directory exists.
    await sftp.mkdir(config.remotePath, true).catch(err => {
      // It's okay if the directory already exists. Re-throw other errors.
      if (err.code !== 4 && !err.message.includes('exists')) {
        throw err;
      }
    });

    const items = await sftp.list(config.remotePath);
    for (const item of items) {
      const remoteItemPath = path.posix.join(config.remotePath, item.name);
      console.log(`   - Deleting ${item.name}`);
      if (item.type === 'd') {
        // Recursively delete directory
        await sftp.rmdir(remoteItemPath, true);
      } else {
        // Delete file
        await sftp.delete(remoteItemPath);
      }
    }

    console.log(`⬆️  Uploading files from ${localPath} to ${config.remotePath}...`);
    const result = await sftp.uploadDir(localPath, config.remotePath);
    
    console.log(`✅ ${result}`);
    console.log('🎉 Deployment successful!');
  } catch (err) {
    console.error(`❌ Deployment failed: ${err.message}`);
    process.exit(1);
  } finally {
    await sftp.end();
    console.log('🔌 Connection closed.');
  }
}

main();