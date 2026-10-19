/* Reference opusfile over bounded worker-owned File callbacks. No MEMFS copy.
 * Asyncify yields inside reads so even open/seek scans receive cancellation.
 * Each caller owns a context; JS serializes C entry, including async unwinds. */
#include <emscripten.h>
#include <opusfile.h>
#include <stdlib.h>
#include <stdint.h>

typedef struct {
  int source;
  int64_t position, length;
  OggOpusFile *file;
  int error;
  int at_eof;
} ZciOpus;

EM_ASYNC_JS(int, source_read, (int id, double position, unsigned char *out, int length), {
  return await Module.readSource(id, position, out, length);
});
static int read_cb(void *opaque, unsigned char *out, int length) {
  ZciOpus *c = opaque;
  if (length > 32768) length = 32768;
  int n = source_read(c->source, (double)c->position, out, length);
  if (n >= 0) c->position += n;
  return n;
}
static int seek_cb(void *opaque, opus_int64 offset, int origin) {
  ZciOpus *c = opaque;
  int64_t base = origin == 0 ? 0 : origin == 1 ? c->position : origin == 2 ? c->length : -1;
  if (base < 0 || offset < -base || offset > c->length - base) return -1;
  c->position = base + offset;
  return 0;
}
static opus_int64 tell_cb(void *opaque) { return ((ZciOpus *)opaque)->position; }
static int close_cb(void *opaque) { (void)opaque; return 0; }
static const OpusFileCallbacks callbacks = {read_cb, seek_cb, tell_cb, close_cb};

EMSCRIPTEN_KEEPALIVE ZciOpus *zci_create(int source, double length) {
  if (length < 0 || length > 1073741824) return NULL;
  ZciOpus *c = calloc(1, sizeof(*c));
  if (c) { c->source = source; c->length = (int64_t)length; }
  return c;
}
EMSCRIPTEN_KEEPALIVE int zci_open(ZciOpus *c) {
  c->file = op_open_callbacks(c, &callbacks, NULL, 0, &c->error);
  if (!c->file) return c->error;
  int links = op_link_count(c->file);
  if (links < 1 || links > 1024) return OP_EIMPL;
  int bytes = 0;
  for (int i = 0; i < links; ++i) {
    const OpusHead *h = op_head(c->file, i);
    if (h->mapping_family != 0 || h->channel_count < 1 || h->channel_count > 2) return OP_EIMPL;
    const OpusTags *t = op_tags(c->file, i);
    if (t->comments < 0 || t->comments > 65536) return OP_EBADHEADER;
    for (int j = 0; j < t->comments; ++j) {
      if (t->comment_lengths[j] < 0 || t->comment_lengths[j] > 65536 - bytes) return OP_EBADHEADER;
      bytes += t->comment_lengths[j];
    }
  }
  return op_set_gain_offset(c->file, OP_HEADER_GAIN, 0);
}
EMSCRIPTEN_KEEPALIVE double zci_total(ZciOpus *c) { return (double)op_pcm_total(c->file, -1); }
EMSCRIPTEN_KEEPALIVE int zci_links(ZciOpus *c) { return op_link_count(c->file); }
EMSCRIPTEN_KEEPALIVE double zci_position(ZciOpus *c) { return c->at_eof ? (double)op_pcm_total(c->file, -1) : (double)op_pcm_tell(c->file); }
EMSCRIPTEN_KEEPALIVE int zci_read(ZciOpus *c, float *out, int samples) {
  if (c->at_eof) return 0;
  int result = op_read_float_stereo(c->file, out, samples);
  if (result == 0) c->at_eof = 1;
  return result;
}
EMSCRIPTEN_KEEPALIVE int zci_seek(ZciOpus *c, double frame) {
  /* Match the native provider's explicit EOF seek: opusfile rejects exactly
   * total on some trimmed files, but the public timeline includes that point. */
  c->at_eof = frame >= (double)op_pcm_total(c->file, -1);
  return c->at_eof ? 0 : op_pcm_seek(c->file, (opus_int64)frame);
}
EMSCRIPTEN_KEEPALIVE void zci_close(ZciOpus *c) {
  if (!c) return;
  if (c->file) op_free(c->file);
  free(c);
}
