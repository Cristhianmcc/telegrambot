/**
 * Descarga una imagen remota y verifica si es un archivo de imagen válido (JPEG, PNG, WebP).
 * Soporta URLs directas y enlaces de Google Drive.
 */
export async function fetchImageBuffer(rawUrl: string): Promise<{ buffer: Buffer; mime: string } | null> {
  if (!rawUrl || !rawUrl.trim()) return null;

  let urlToFetch = rawUrl.trim();

  // Si es un enlace de Google Drive, intentar URL de descarga directa
  const driveMatch = urlToFetch.match(/id=([a-zA-Z0-9_-]+)/) || urlToFetch.match(/\/d\/([a-zA-Z0-9_-]+)/);
  const candidates: string[] = [];

  if (driveMatch) {
    const fileId = driveMatch[1];
    candidates.push(`https://lh3.googleusercontent.com/d/${fileId}`);
    candidates.push(`https://drive.google.com/uc?export=download&id=${fileId}`);
    candidates.push(`https://drive.google.com/thumbnail?id=${fileId}&sz=w1200`);
  }
  candidates.push(urlToFetch);

  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        redirect: 'follow'
      });

      if (!res.ok) continue;

      const contentType = res.headers.get('content-type') || '';
      const arrayBuf = await res.arrayBuffer();
      const buf = Buffer.from(arrayBuf);

      if (buf.length < 100) continue;

      // Verificar si es imagen por headers o por "magic bytes"
      const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
      const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
      const isWebp = buf.toString('ascii', 8, 12) === 'WEBP';
      const isGif = buf.toString('ascii', 0, 3) === 'GIF';

      if (contentType.startsWith('image/') || isJpeg || isPng || isWebp || isGif) {
        let mime = 'image/jpeg';
        if (isPng || contentType.includes('png')) mime = 'image/png';
        else if (isWebp || contentType.includes('webp')) mime = 'image/webp';
        return { buffer: buf, mime };
      }
    } catch {
      // Continuar con el siguiente candidato
    }
  }

  return null;
}
