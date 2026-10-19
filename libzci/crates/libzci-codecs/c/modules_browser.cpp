// Browser provider mechanisms. All entry points are per-instance; long Hively
// duration and seek work is stepped so the owning worker can yield/cancel.
#include <libopenmpt/libopenmpt.h>
#include <libopenmpt/libopenmpt_ext.h>
#include "hively_context.h"
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <algorithm>
struct Zcm {
  openmpt_module_ext *ext = nullptr; openmpt_module *mod = nullptr;
  openmpt_module_ext_interface_interactive interactive{};
  lz_hively_ctx *hvl = nullptr;
  double position = 0, total = 0, speed = 1;
  unsigned repeats = 0;
  char text[4097]{};
};
extern "C" {
void zcm_close(Zcm *c) { if (!c) return; if(c->ext) openmpt_module_ext_destroy(c->ext); if(c->hvl) lz_hively_close(c->hvl); delete c; }
Zcm *zcm_create(const unsigned char *data, unsigned len, int hively) {
  if(len > (64u<<20)) return nullptr;
  Zcm *c = new(std::nothrow) Zcm(); if(!c) return nullptr;
  if(hively) {
    static bool initialized=false; if(!initialized) {lz_hively_init_tables();initialized=true;}
    char error[32]; c->hvl=lz_hively_open(data,len,48000,error,sizeof(error));
    if(!c->hvl) {delete c;return nullptr;}
  } else {
    int error=0; const char *message=nullptr;
    c->ext=openmpt_module_ext_create_from_memory(data,len,nullptr,nullptr,nullptr,nullptr,&error,&message,nullptr);
    if(message) openmpt_free_string(message);
    if(!c->ext) {delete c;return nullptr;}
    c->mod=openmpt_module_ext_get_module(c->ext);
    openmpt_module_ext_get_interface(c->ext,LIBOPENMPT_EXT_C_INTERFACE_INTERACTIVE,&c->interactive,sizeof(c->interactive));
    openmpt_module_set_repeat_count(c->mod,0);
    openmpt_module_set_render_param(c->mod,OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH,4);
    c->total=std::round(openmpt_module_get_duration_seconds(c->mod)*48000);
    if(!std::isfinite(c->total)||c->total<=0||c->total>=43200.0*48000) {zcm_close(c);return nullptr;}
  }
  return c;
}
// 0 = continue, 1 = complete, -1 = failure/cap exceeded.
int zcm_probe_step(Zcm *c) {
  if(!c) return -1; if(!c->hvl) return 1;
  unsigned rendered=0,duration=0;int ended=0;
  if(!lz_hively_probe_step(c->hvl,256,&rendered,&ended,&duration)) return -1;
  if(ended) {c->total=double(duration)*lz_hively_frame_samples(c->hvl);return c->total>0?1:-1;}
  return duration>=LZ_HIVELY_MAX_DURATION_FRAMES?-2:0;
}
double zcm_total(Zcm *c) {return c->total;}
double zcm_position(Zcm *c) {return c->position;}
int zcm_read(Zcm *c,float *out,unsigned frames) {
  frames=std::min(frames,4096u);
  frames=std::min(frames,unsigned(std::max(0.0,c->total-c->position)));
  if(!frames) return 0;
  unsigned got=c->hvl?lz_hively_render_float(c->hvl,out,frames):openmpt_module_read_interleaved_float_stereo(c->mod,48000,frames,out);
  c->position+=got;return int(got);
}
int zcm_seek_step(Zcm *c,double target) {
  if(!std::isfinite(target)||target<0) return -1; target=std::min(target,c->total);
  if(c->hvl) {
    unsigned step=lz_hively_frame_samples(c->hvl),p=0;
    unsigned frame=unsigned(target)/step;
    if(!lz_hively_seek_step(c->hvl,frame,256,&p)) return -1;
    c->position=double(p)*step;
    if(p<frame) return 0;
    unsigned remainder=unsigned(target)%step;
    if(remainder) {float scratch[1920];c->position+=lz_hively_render_float(c->hvl,scratch,remainder);}
  } else { c->position=std::round(openmpt_module_set_position_seconds(c->mod,target*c->speed/48000)*48000/c->speed); }
  return 1;
}
int zcm_control(Zcm *c,int kind,double value) {
  if(!std::isfinite(value)) return -1;
  switch(kind) {
    case 0: // subsong
      if(value<0||value>=double(c->hvl?lz_hively_subsong_count(c->hvl):openmpt_module_get_num_subsongs(c->mod))) return -1;
      if(c->hvl) { if(!lz_hively_select_subsong(c->hvl,unsigned(value))) return -1; c->total=0; }
      else {openmpt_module_select_subsong(c->mod,int(value));c->total=std::round(openmpt_module_get_duration_seconds(c->mod)*48000*(c->repeats+1)/c->speed);}
      c->position=0;return 1;
    case 1:
      if(value!=1&&value!=2&&value!=4&&value!=8) return -1;
      if(c->hvl) {lz_hively_set_interpolation(c->hvl,unsigned(value));return 1;}
      return openmpt_module_set_render_param(c->mod,OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH,int(value));
    case 2: return c->mod&&value>=-1&&value<=10?openmpt_module_set_render_param(c->mod,OPENMPT_MODULE_RENDER_VOLUMERAMPING_STRENGTH,int(value)):-1;
    case 3:
      if(!c->mod||!c->interactive.set_tempo_factor||value<0.25||value>4) return -1;
      if(!c->interactive.set_tempo_factor(c->ext,value)) return -1;
      c->speed=value;c->total=std::round(openmpt_module_get_duration_seconds(c->mod)*48000*(c->repeats+1)/c->speed);return 1;
    case 4: return c->mod&&c->interactive.set_pitch_factor&&value>=0.25&&value<=4?c->interactive.set_pitch_factor(c->ext,value):-1;
    case 5:
      if(!c->mod||value<0||value>16) return -1;
      c->repeats=unsigned(value);openmpt_module_set_repeat_count(c->mod,int(value));
      c->total=std::round(openmpt_module_get_duration_seconds(c->mod)*48000*(c->repeats+1)/c->speed);return 1;
    case 6: case 7:
      if(value<0) return -1;
      return c->hvl?lz_hively_set_channel_mute(c->hvl,unsigned(value),kind==6):
        (c->interactive.set_channel_mute_status?c->interactive.set_channel_mute_status(c->ext,int(value),kind==6):-1);
    default:return -1;
  }
}
int zcm_fact(Zcm *c,int key) {
  switch(key) {
    case 0:return c->hvl?lz_hively_subsong_count(c->hvl):openmpt_module_get_num_subsongs(c->mod);
    case 1:return c->hvl?lz_hively_channel_count(c->hvl):openmpt_module_get_num_channels(c->mod);
    case 2:return c->hvl?lz_hively_subsong(c->hvl):openmpt_module_get_selected_subsong(c->mod);
    case 3:return c->hvl?lz_hively_order(c->hvl):openmpt_module_get_current_order(c->mod);
    case 4:return c->hvl?lz_hively_row(c->hvl):openmpt_module_get_current_row(c->mod);
    case 5:return c->hvl?lz_hively_order(c->hvl):openmpt_module_get_current_pattern(c->mod);
    case 6:return c->hvl?lz_hively_pattern_rows(c->hvl):openmpt_module_get_pattern_num_rows(c->mod,openmpt_module_get_current_pattern(c->mod));
    case 7:return !c->hvl&&c->interactive.set_tempo_factor;
    case 8:return !c->hvl&&c->interactive.set_pitch_factor;
    case 9:return c->hvl||c->interactive.set_channel_mute_status;
  } return 0;
}
const char *zcm_text(Zcm *c,int key) {
  if(c->hvl) { unsigned len=0;const char *s=lz_hively_title(c->hvl,&len);len=std::min(len,128u);std::memcpy(c->text,s,len);c->text[len]=0; }
  else {const char *keys[]={"title","type","tracker","artist","message"};const char *s=openmpt_module_get_metadata(c->mod,keys[std::clamp(key,0,4)]);std::strncpy(c->text,s?s:"",4096);c->text[4096]=0;if(s)openmpt_free_string(s);}
  return c->text;
}
int zcm_cell(Zcm *c,int row,int channel,int command) {
  if(row<0||channel<0||command<0||command>5||channel>=zcm_fact(c,1)||row>=zcm_fact(c,6)) return 0;
  if(c->hvl) {unsigned char out[6]{};lz_hively_pattern_cell(c->hvl,lz_hively_order(c->hvl),row,channel,out);return out[command];}
  return openmpt_module_get_pattern_row_channel_command(c->mod,openmpt_module_get_current_pattern(c->mod),row,channel,command);
}
}
