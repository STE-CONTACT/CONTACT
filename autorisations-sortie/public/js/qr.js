// Lecture de QR code avec la caméra de la tablette (BarcodeDetector natif, sinon jsQR).
import { modal, toast } from './ui.js';

let jsQRLoading = null;
function loadJsQR() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  if (!jsQRLoading) {
    jsQRLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/vendor/jsQR.js';
      s.onload = () => resolve(window.jsQR);
      s.onerror = () => reject(new Error('Lecteur QR indisponible'));
      document.head.appendChild(s);
    });
  }
  return jsQRLoading;
}

/** Ouvre la caméra et retourne le texte du QR code lu (ou null si annulé). */
export function scanQr() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast('Caméra non disponible (HTTPS requis sur tablette). Utilisez la recherche par matricule.', 'error', { timeout: 7000 });
    return Promise.resolve(null);
  }
  let stream = null; let stopped = false; let found = null;
  const stop = () => { stopped = true; if (stream) stream.getTracks().forEach((t) => t.stop()); };
  return modal({
    title: 'Scanner le QR code du badge',
    body: '<div class="scanner"><video playsinline muted></video><div class="frame"></div></div><p class="muted center mt">Présentez le badge devant la caméra.</p>',
    actions: [{ label: 'Annuler', value: null }],
    onOpen: async (body, close) => {
      const video = body.querySelector('video');
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        video.srcObject = stream;
        await video.play();
      } catch {
        toast("Accès à la caméra refusé ou impossible.", 'error');
        close(null); return;
      }
      let detector = null;
      if ('BarcodeDetector' in window) {
        try { detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch { detector = null; }
      }
      const jsQR = detector ? null : await loadJsQR().catch(() => null);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const tick = async () => {
        if (stopped || !document.body.contains(video)) { stop(); return; }
        try {
          if (video.readyState >= 2) {
            if (detector) {
              const codes = await detector.detect(video);
              if (codes.length) found = codes[0].rawValue;
            } else if (jsQR) {
              canvas.width = video.videoWidth; canvas.height = video.videoHeight;
              ctx.drawImage(video, 0, 0);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
              if (code) found = code.data;
            }
          }
        } catch { /* image suivante */ }
        if (found) { stop(); close(found); return; }
        setTimeout(tick, 180);
      };
      tick();
    },
  }).then((v) => { stop(); return v || found; });
}
