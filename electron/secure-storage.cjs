'use strict';
// Electron can report encryption as available on Linux with a hardcoded key.
// Never persist credentials or device tokens through that fallback.
function secureStorageAvailable(storage) {
  try {
    return !!storage?.isEncryptionAvailable?.() &&
      storage.getSelectedStorageBackend?.() !== 'basic_text';
  } catch { return false; }
}
module.exports={secureStorageAvailable};
