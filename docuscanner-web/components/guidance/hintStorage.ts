// Where a first-use tip's "Got it" is remembered, shared by the Hint component and the
// pre-paint script below. (Not a client module, so app/layout.tsx can import the script.)

export const HINT_KEY_PREFIX = "docuscanner.hint.";

// Tips are part of the server HTML, so a first-time visitor's page does not jump when one
// appears after hydration (that jump was a Cumulative Layout Shift on every editor page).
// This runs in <head> before the first paint and hides the tips this browser has already
// dismissed, so a returning visitor never sees them flash. If storage is blocked, Hint
// treats every tip as dismissed, so this hides them all.
export const HINT_INIT_SCRIPT = `(function(){var c="";try{var s=localStorage,p=${JSON.stringify(HINT_KEY_PREFIX)};for(var i=0;i<s.length;i++){var k=s.key(i);if(k&&k.indexOf(p)===0&&s.getItem(k)==="1")c+='[data-hint-id="'+k.slice(p.length).replace(/["\\\\]/g,"\\\\$&")+'"],'}}catch(e){c="[data-hint-id],"}if(c){var el=document.createElement("style");el.textContent=c.slice(0,-1)+"{display:none!important}";document.head.appendChild(el)}})()`;
