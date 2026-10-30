import init from './generated/libzci_web.js';
let ready:Promise<unknown>|null=null;
/** All document-owned core objects share one initialization promise. */
export const initializeControl=():Promise<unknown>=>ready??=init();
