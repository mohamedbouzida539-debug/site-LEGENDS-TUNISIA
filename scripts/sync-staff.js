#!/usr/bin/env node
/**
 * Syncs the "Staff" section of index.html with the live members of specific
 * Discord roles. Run by .github/workflows/sync-staff.yml on a schedule.
 *
 * Requires env vars:
 *   DISCORD_BOT_TOKEN   - bot token, needs the "Server Members Intent" enabled
 *                          in the Discord Developer Portal and the bot invited
 *                          to the server with permission to view members.
 *   DISCORD_GUILD_ID    - server (guild) ID. Defaults to LeGeNds TUNISIA's ID.
 *   ROLE_ID_HEAD_ADMIN
 *   ROLE_ID_MODERATOR
 *   ROLE_ID_STAFF_TEAM
 *   ROLE_ID_TRIAL_STAFF - the four role IDs to pull members from (Server
 *                          Settings -> Roles -> ... -> Copy Role ID).
 */

const fs = require('fs');
const path = require('path');

const GUILD_ID = process.env.DISCORD_GUILD_ID || '1511674199914320082';
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const INDEX_HTML = path.join(__dirname, '..', 'index.html');

const ROLE_MAP = [
  { key: 'head-admin', label: 'Head Admin', roleId: process.env.ROLE_ID_HEAD_ADMIN },
  { key: 'moderator', label: 'Moderator', roleId: process.env.ROLE_ID_MODERATOR },
  { key: 'staff-team', label: 'Staff Team', roleId: process.env.ROLE_ID_STAFF_TEAM },
  { key: 'trial-staff', label: 'Trial Staff', roleId: process.env.ROLE_ID_TRIAL_STAFF },
];

async function fetchAllMembers() {
  const members = [];
  let after = '0';
  for (;;) {
    const url = `https://discord.com/api/v10/guilds/${GUILD_ID}/members?limit=1000&after=${after}`;
    const res = await fetch(url, { headers: { Authorization: `Bot ${BOT_TOKEN}` } });
    if (!res.ok) {
      throw new Error(`Discord API error ${res.status}: ${await res.text()}`);
    }
    const batch = await res.json();
    if (batch.length === 0) break;
    members.push(...batch);
    after = batch[batch.length - 1].user.id;
    if (batch.length < 1000) break;
  }
  return members;
}

function avatarUrl(user) {
  if (!user.avatar) return '';
  const ext = user.avatar.startsWith('a_') ? 'gif' : 'webp';
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=128`;
}

function displayName(member) {
  return member.nick || member.user.global_name || member.user.username;
}

function jsString(s) {
  return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function buildBlock(staffMembers) {
  const lines = ['  const staffMembers = {'];
  for (const { key, label, people } of staffMembers) {
    lines.push(`    ${jsString(key)}: { label: ${jsString(label)}, people: [`);
    for (const p of people) {
      lines.push(
        `      { name: ${jsString(p.name)}, handle: ${jsString(p.handle)}, avatar: ${jsString(p.avatar)} },`
      );
    }
    lines.push('    ]},');
  }
  lines.push('  };');
  return lines.join('\n');
}

async function main() {
  if (!BOT_TOKEN) throw new Error('Missing DISCORD_BOT_TOKEN env var');

  const missingRoles = ROLE_MAP.filter((r) => !r.roleId);
  if (missingRoles.length) {
    console.warn(
      `Warning: missing role IDs for ${missingRoles.map((r) => r.key).join(', ')} — those sections will be left empty.`
    );
  }

  const members = await fetchAllMembers();

  const staffMembers = ROLE_MAP.map(({ key, label, roleId }) => ({
    key,
    label,
    people: roleId
      ? members
          .filter((m) => m.roles.includes(roleId))
          .map((m) => ({
            name: displayName(m),
            handle: '@' + m.user.username,
            avatar: avatarUrl(m.user),
          }))
      : [],
  }));

  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const startMarker = '// STAFF_DATA_START';
  const endMarker = '// STAFF_DATA_END';
  const startIdx = html.indexOf(startMarker);
  const endIdx = html.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error('Could not find STAFF_DATA_START/STAFF_DATA_END markers in index.html');
  }

  const before = html.slice(0, startIdx + startMarker.length);
  const after = html.slice(endIdx);
  const updated = `${before}\n${buildBlock(staffMembers)}\n  ${after}`;

  fs.writeFileSync(INDEX_HTML, updated);
  console.log('staff-team synced:', staffMembers.map((s) => `${s.key}=${s.people.length}`).join(', '));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
