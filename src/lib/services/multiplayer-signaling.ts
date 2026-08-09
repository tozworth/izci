import type { Unsubscribe } from 'firebase/database';
import type { MultiplayerIceSettings } from './multiplayer-ice';
import type { FirebaseRuntime, SignalOffer } from './multiplayer-types';
import {
  createMultiplayerTurnCredentialRequest,
  isMultiplayerTurnCredentialResponse
} from './multiplayer-turn-credentials';

export const FIREBASE_CONFIG = {
  projectId: 'izci-pwa',
  appId: '1:397825145921:web:92d428cf3c65fa2fab5ac0',
  storageBucket: 'izci-pwa.firebasestorage.app',
  apiKey: 'AIzaSyBZ1hxyPdzo3xQyb9Urk7XQG708-R5S-3w',
  authDomain: 'izci-pwa.firebaseapp.com',
  messagingSenderId: '397825145921',
  databaseURL: 'https://izci-pwa-default-rtdb.europe-west1.firebasedatabase.app'
} as const;

export const TURN_CREDENTIAL_RESPONSE_TIMEOUT_MS = 15_000;

export function createDirectIceSettings(): MultiplayerIceSettings {
  return {
    multiplayerTurnUrl: '',
    multiplayerTurnUsername: '',
    multiplayerTurnCredential: '',
    multiplayerForceTurn: false
  };
}

export function isSignalOffer(value: unknown): value is SignalOffer {
  if (!value || typeof value !== 'object') return false;
  const offer = value as Partial<SignalOffer>;
  return typeof offer.name === 'string'
    && typeof offer.platform === 'string'
    && typeof offer.createdAt === 'number'
    && Boolean(offer.description)
    && (offer.description?.type === 'offer');
}

export function createInviteCode(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

export function normalizeInviteCode(value: string): string | null {
  const trimmed = value.trim();
  const fragmentMatch = trimmed.match(/(?:^|[#?&])(?:multiplayer|room)=([a-z0-9]{8})(?![a-z0-9])/);
  const code = fragmentMatch?.[1] ?? trimmed;
  return /^[a-z0-9]{8}$/.test(code) ? code : null;
}

export async function loadFirebase(): Promise<FirebaseRuntime> {
  const [appModule, authModule, databaseModule] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
    import('firebase/database')
  ]);
  const app = appModule.getApps().find((candidate) => candidate.options.projectId === FIREBASE_CONFIG.projectId)
    ?? appModule.initializeApp(FIREBASE_CONFIG);
  const auth = authModule.getAuth(app);
  await authModule.setPersistence(auth, authModule.browserLocalPersistence);
  await auth.authStateReady();
  const credential = auth.currentUser
    ? { user: auth.currentUser }
    : await authModule.signInAnonymously(auth);

  return {
    database: databaseModule.getDatabase(app),
    uid: credential.user.uid,
    ref: databaseModule.ref,
    set: databaseModule.set,
    get: databaseModule.get,
    remove: databaseModule.remove,
    onValue: databaseModule.onValue,
    onDisconnect: databaseModule.onDisconnect
  };
}

export async function requestTemporaryTurnCredentials(
  firebase: FirebaseRuntime,
  inviteCode: string
): Promise<MultiplayerIceSettings> {
  const pending = await createMultiplayerTurnCredentialRequest();
  const requestRef = firebase.ref(
    firebase.database,
    `multiplayer/rooms/${inviteCode}/peers/${firebase.uid}/credentialRequest`
  );
  const responseRef = firebase.ref(
    firebase.database,
    `multiplayer/rooms/${inviteCode}/peers/${firebase.uid}/credentialResponse`
  );
  await firebase.set(requestRef, pending.request);

  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe: Unsubscribe | null = null;
    const finish = (
      result: MultiplayerIceSettings | null,
      error?: unknown
    ) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      unsubscribe?.();
      void firebase.remove(requestRef).catch(() => undefined);
      if (result) resolve(result);
      else reject(error instanceof Error ? error : new Error('TURN credential exchange failed.'));
    };
    const timeout = window.setTimeout(() => {
      finish(null, new Error('The host did not provide temporary TURN credentials in time.'));
    }, TURN_CREDENTIAL_RESPONSE_TIMEOUT_MS);

    unsubscribe = firebase.onValue(responseRef, (snapshot) => {
      const response = snapshot.val() as unknown;
      if (!isMultiplayerTurnCredentialResponse(response)
        || response.requestId !== pending.request.requestId) return;
      void pending.decrypt(response)
        .then((settings) => finish(settings))
        .catch((error) => finish(null, error));
    });
  });
}
