/** Configuration locale du Web Clipper (les secrets ne sont jamais synchronisés). */
const MN_CONFIG_KEYS = ['appUrl', 'apiToken', 'aiModel'];
const MN_MIGRATED_FLAG = '__mn_config_local_v1';

async function mnMigrateSyncToLocal() {
  const local = await chrome.storage.local.get([MN_MIGRATED_FLAG, ...MN_CONFIG_KEYS]);
  if (local[MN_MIGRATED_FLAG]) return;
  const legacy = await chrome.storage.sync.get(MN_CONFIG_KEYS);
  const carried = {};
  for (const key of MN_CONFIG_KEYS) {
    if (local[key] === undefined && legacy[key] !== undefined) carried[key] = legacy[key];
  }
  await chrome.storage.local.set({ ...carried, [MN_MIGRATED_FLAG]: true });
  await chrome.storage.sync.remove(MN_CONFIG_KEYS);
}

async function mnGetConfig(defaults) {
  await mnMigrateSyncToLocal();
  return chrome.storage.local.get(defaults);
}

async function mnSetConfig(values) {
  await mnMigrateSyncToLocal();
  return chrome.storage.local.set(values);
}
