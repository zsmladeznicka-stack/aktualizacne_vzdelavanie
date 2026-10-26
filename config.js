// Nastavenia aplikácie. Kým je API_URL prázdne, aplikácia beží v ukážkovom režime
// (bez Google prihlásenia, priebeh sa ukladá len v prehliadači).
window.APP_CONFIG = {
  // Client ID z Google Cloud Console (rovnaké ako CONFIG.CLIENT_ID v Code.gs)
  GOOGLE_CLIENT_ID: '360446448624-q4u3huhlgho4ce4taptuofp0e4dveujp.apps.googleusercontent.com',
  // URL nasadenej Apps Script webovej aplikácie (končí na /exec)
  API_URL: '',
  // Povolená doména školských účtov
  DOMAIN: 'koharysuli.sk',
};
