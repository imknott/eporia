/* public/javascripts/uploadHelper.js */

async function uploadFileToR2(file, type) {
  // 1. Get the Signed URL
  const res = await fetch('/api/storage/get-upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
        type: type, // 'profile' or 'crate'
        fileExtension: file.name.split('.').pop() 
    })
  });
  
  const { uploadUrl } = await res.json();

  // 2. Upload directly to Cloudflare (Bypassing your Node server to save RAM)
  await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type }
  });
  
  return uploadUrl.split('?')[0]; // Return the clean public URL
}