import type {SourceReference} from './profile-types.js';
export interface Metadata {title:string;artist:string;album:string;genre:string;year:number|null;track:number|null;disc:number|null;duration_seconds:number|null}
export interface MediaInput {source:SourceReference;kind:'audio'|'module'|'video'|'image';source_revision:string;metadata:Metadata}
export interface CatalogRow extends MediaInput {id:number;in_library:boolean;facts:{favorite:boolean;rating:number;play_count:number;last_played_ms:number|null}}
export interface CatalogPage {revision:number;total:number;rows:CatalogRow[]}
export type CatalogGroupBy='artist'|'album'|'genre'|'kind';
export interface CatalogGroupPage {revision:number;total:number;groups:{key:string[];count:number}[]}
export interface CatalogQuery {collection?:'library'|'favorites'|'all';kind?:MediaInput['kind'];root?:number;media?:number;source_key?:string;subsong?:number;search?:string;artist?:string;album?:string;genre?:string;sort?:'title'|'artist'|'album'|'rating'|'play_count'|'path';descending?:boolean;offset?:number;limit?:number;revision?:number}
export interface ScanSettings {recursive:boolean;scan_on_launch:boolean;verify_unknown:boolean;probe_concurrency:number}
export interface ManagedRoot {id:number;revision:number;config:{source:SourceReference;settings:ScanSettings}}
export interface ScanPlan {token:string;root:ManagedRoot;max_batch:number;max_entries:number;max_bytes:number;max_total_bytes:number}
export interface Bookmark {id:number;media:number;subsong:number|null;position_seconds:number;label:string}
export type CatalogCommand={kind:'add';media:MediaInput[]}|{kind:'remove';media:number[]}|{kind:'favorite';media:number;subsong:number|null;favorite:boolean}|{kind:'rate';media:number;subsong:number|null;rating:number}|{kind:'bookmark';media:number;subsong:number|null;position_seconds:number;label:string}|{kind:'remove_bookmark';id:number}|{kind:'root';root:ManagedRoot['config']}|{kind:'remove_root';root:number}|{kind:'finish_scan';token:string};
export interface CatalogOutcome {duplicate:boolean;revision:number;media:number[];bookmark:number|null;root:number|null;scan:{root:number;entries:number;added:number;removed:number}|null}
export interface ScanObservation {state:'idle'|'scanning'|'failed';root:number|null;visited:number;accepted:number;ignored:number;detail:string}
