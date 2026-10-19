//! Explicit browser fact serialization; no consumer-owned transport policy.
use libzci::*;
use serde_json::{json, Value};
pub fn capabilities(c: ModuleCapabilities) -> Value {
    json!({"subsongs":c.subsongs,"channels":c.channels,"interpolation":c.interpolation,"channel_mute":c.channel_mute,
    "ramping":c.ramping,"speed":c.speed,"pitch":c.pitch,"loop_limit":c.loop_limit,"patterns":c.patterns})
}
pub fn module(m: Option<ModuleObservation>) -> Value {
    m.map(|m|json!({"selected_subsong":m.selected_subsong,"order":m.order,"pattern":m.pattern,"row":m.row,"first_row":m.first_row,"rows":m.rows,"channels":m.channels,"cells":m.cells})).unwrap_or(Value::Null)
}
pub fn facts(m: ProviderMetadata, c: ModuleCapabilities, o: Option<ModuleObservation>) -> Value {
    json!({"provider":{"id":m.info.id.0,"name":m.info.display_name,"version":m.info.version},"rate":m.layout.sample_rate,"channels":m.layout.layout.channels(),"total":m.total_frames,
        "comments":m.comments,"capabilities":capabilities(c),"module":module(o),"applied":{"trimmed_preskip":m.applied.trimmed_preskip,"trimmed_end":m.applied.trimmed_end,"applied_header_gain":m.applied.applied_header_gain}})
}
pub fn control(kind: &str, value: f64) -> Result<ModuleControl> {
    let integer = || {
        if value.is_finite() && value.fract() == 0.0 && value >= 0.0 && value <= u32::MAX as f64 {
            Ok(value as u32)
        } else {
            Err(LibzciError::InvalidArgument {
                detail: "integer module parameter required".into(),
            })
        }
    };
    Ok(match kind {
        "subsong" => ModuleControl::Subsong(integer()?),
        "interpolation" => ModuleControl::Interpolation(integer()?),
        "ramping"
            if value.is_finite() && value.fract() == 0.0 && (-1.0..=10.0).contains(&value) =>
        {
            ModuleControl::Ramping(value as i32)
        }
        "speed" => ModuleControl::Speed(value),
        "pitch" => ModuleControl::Pitch(value),
        "loops" => ModuleControl::LoopLimit(integer()?),
        "channel-mute" | "channel-unmute" => ModuleControl::ChannelMute {
            channel: integer()?,
            mute: kind == "channel-mute",
        },
        _ => {
            return Err(LibzciError::InvalidArgument {
                detail: format!("unknown module parameter {kind}"),
            })
        }
    })
}
pub fn control_value(c: ModuleControl) -> Value {
    match c {
        ModuleControl::Subsong(n) => json!({"kind":"subsong","value":n}),
        ModuleControl::Interpolation(n) => json!({"kind":"interpolation","value":n}),
        ModuleControl::Ramping(n) => json!({"kind":"ramping","value":n}),
        ModuleControl::Speed(n) => json!({"kind":"speed","value":n}),
        ModuleControl::Pitch(n) => json!({"kind":"pitch","value":n}),
        ModuleControl::LoopLimit(n) => json!({"kind":"loops","value":n}),
        ModuleControl::ChannelMute { channel, mute } => {
            json!({"kind":if mute {"channel-mute"} else {"channel-unmute"},"value":channel})
        }
    }
}
