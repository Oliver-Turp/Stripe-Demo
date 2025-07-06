import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load environment variables
dotenv.config();

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const STRIPE_LOG_CHANNEL_ID = process.env.STRIPE_LOG_CHANNEL_ID;

if (!DISCORD_BOT_TOKEN || !STRIPE_LOG_CHANNEL_ID) {
  console.error('❌ Missing required environment variables:');
  if (!DISCORD_BOT_TOKEN) console.error('  - DISCORD_BOT_TOKEN');
  if (!STRIPE_LOG_CHANNEL_ID) console.error('  - STRIPE_LOG_CHANNEL_ID');
  process.exit(1);
}

function updateEnvFile(webhookUrl) {
  try {
    const envPath = path.join(process.cwd(), '.env');

    // Read current .env file
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }

    // Check if DISCORD_WEBHOOK_URL already exists
    const lines = envContent.split('\n');
    let found = false;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('DISCORD_WEBHOOK_URL=')) {
        lines[i] = `DISCORD_WEBHOOK_URL=${webhookUrl}`;
        found = true;
        console.log('✏️  Updating existing DISCORD_WEBHOOK_URL in .env file');
        break;
      }
    }

    // If not found, add it
    if (!found) {
      lines.push(`DISCORD_WEBHOOK_URL=${webhookUrl}`);
      console.log('➕ Added DISCORD_WEBHOOK_URL to .env file');
    }

    // Write back to file
    fs.writeFileSync(envPath, lines.join('\n'));
    console.log('✅ .env file updated successfully');

  } catch (error) {
    console.error('⚠️  Could not update .env file:', error.message);
    console.log('💡 Please manually add this to your .env file:');
    console.log(`DISCORD_WEBHOOK_URL=${webhookUrl}`);
  }
}


async function createDiscordWebhook() {
  try {
    console.log('🔍 Checking for existing webhooks...');

    // Check if webhook already exists
    const existingWebhooks = await fetch(
      `https://discord.com/api/v10/channels/${STRIPE_LOG_CHANNEL_ID}/webhooks`,
      {
        headers: {
          'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!existingWebhooks.ok) {
      throw new Error(`Failed to fetch webhooks: ${existingWebhooks.status} ${existingWebhooks.statusText}`);
    }

    const webhooks = await existingWebhooks.json();

    // Look for existing Stripe webhook
    const stripeWebhook = webhooks.find(webhook =>
      webhook.name === 'Stripe Events' || webhook.name.includes('Stripe')
    );

    if (stripeWebhook) {
      console.log('✅ Stripe webhook already exists!');
      console.log(`   Name: ${stripeWebhook.name}`);
      console.log(`   ID: ${stripeWebhook.id}`);
      console.log(`   URL: ${stripeWebhook.url}`);
      updateEnvFile(stripeWebhook.url);
      return;
    }

    console.log('📝 Creating new Stripe webhook...');

    // Create new webhook
    const createResponse = await fetch(
      `https://discord.com/api/v10/channels/${STRIPE_LOG_CHANNEL_ID}/webhooks`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Stripe Events',
        }),
      }
    );

    if (!createResponse.ok) {
      const errorData = await createResponse.json();
      throw new Error(`Failed to create webhook: ${createResponse.status} ${createResponse.statusText}\n${JSON.stringify(errorData, null, 2)}`);
    }

    const newWebhook = await createResponse.json();

    console.log('✅ Successfully created Stripe webhook!');
    console.log(`   Name: ${newWebhook.name}`);
    console.log(`   ID: ${newWebhook.id}`);
    console.log(`   URL: ${newWebhook.url}`);
    console.log('');
    updateEnvFile(newWebhook.url);

  } catch (error) {
    console.error('❌ Error creating Discord webhook:', error.message);
    process.exit(1);
  }
}

// Run the script
createDiscordWebhook();
