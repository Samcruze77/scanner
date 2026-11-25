// Where a first-use tip's "Got it" is remembered, shared by the Hint component and the
// pre-paint script below. (Not a client module, so app/layout.tsx can import the script.)

export const HINT_KEY_PREFIX = "docuscanner.hint.";

// The header's Help tips switch is in the server HTML, which cannot know this browser's choice.
// Before the first paint this marks <html data-tips="on"> when tips are allowed (everything except an
// explicit "off", like tipsAllowed in utils/guidance/preferences.ts), so the switch shows the right
// state from the start instead of changing after load (components/guidance/TipsToggle.tsx). The key
// and format are preferences.ts's GUIDANCE_KEY ({"tips":"on"|"off"|"unset", ...}). If storage is
// blocked, tips are allowed (as in useGuidance), so it says ON.
// It also hides, before the first paint, any page tip (components/guidance/PageTip.tsx) this browser
// has closed; only plain ids (letters, digits, hyphens) are used in that CSS.
export const TIPS_INIT_SCRIPT = `(function(){var on=true,c="";try{var g=JSON.parse(localStorage.getItem("docuscanner.guidance.v1")||"{}");if(g&&g.tips==="off")on=false;var d=g&&Array.isArray(g.dismissed)?g.dismissed:[];for(var i=0;i<d.length&&i<200;i++){if(typeof d[i]==="string"&&/^[a-z0-9-]+$/.test(d[i]))c+='[data-tip="'+d[i]+'"][data-prepaint],'}}catch(e){}if(on)document.documentElement.setAttribute("data-tips","on");if(c){var s=document.createElement("style");s.textContent=c.slice(0,-1)+"{display:none!important}";document.head.appendChild(s)}})()`;

// Tips are part of the server HTML, so a first-time visitor's page does not jump when one
// appears after hydration (that jump was a Cumulative Layout Shift on every editor page).
// This runs in <head> before the first paint and hides the tips this browser has already
// dismissed, so a returning visitor never sees them flash. If storage is blocked, Hint
// treats every tip as dismissed, so this hides them all.
export const HINT_INIT_SCRIPT = `(function(){var c="";try{var s=localStorage,p=${JSON.stringify(HINT_KEY_PREFIX)};for(var i=0;i<s.length;i++){var k=s.key(i);if(k&&k.indexOf(p)===0&&s.getItem(k)==="1")c+='[data-hint-id="'+k.slice(p.length).replace(/["\\\\]/g,"\\\\$&")+'"],'}}catch(e){c="[data-hint-id],"}if(c){var el=document.createElement("style");el.textContent=c.slice(0,-1)+"{display:none!important}";document.head.appendChild(el)}})()`;
