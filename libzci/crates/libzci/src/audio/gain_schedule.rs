//! Resolved source-timeline gains. Fixed storage is prepared away from output;
//! callbacks select gains using the same source/output mapping as the clock.
use crate::{LibzciError, Result};
pub const MAX_GAIN_POINTS: usize = 1024;
#[derive(Clone, Copy, Debug, PartialEq)]
#[cfg_attr(feature = "control", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "control", serde(deny_unknown_fields))]
pub struct GainPoint {
    pub source_frame: u64,
    pub linear: f32,
}
impl Default for GainPoint {
    fn default() -> Self {
        Self {
            source_frame: 0,
            linear: 1.0,
        }
    }
}
#[derive(Clone)]
pub struct GainSchedule {
    points: [GainPoint; MAX_GAIN_POINTS],
    len: usize,
}
impl Default for GainSchedule {
    fn default() -> Self {
        Self {
            points: [GainPoint::default(); MAX_GAIN_POINTS],
            len: 1,
        }
    }
}
impl GainSchedule {
    pub fn validate(points: &[GainPoint]) -> Result<()> {
        if points.is_empty()
            || points.len() > MAX_GAIN_POINTS
            || points[0].source_frame != 0
            || points
                .iter()
                .any(|p| !p.linear.is_finite() || !(0.0..=1000.0).contains(&p.linear))
            || points
                .windows(2)
                .any(|p| p[0].source_frame >= p[1].source_frame)
        {
            return Err(LibzciError::InvalidArgument {
                detail: "invalid source gain schedule".into(),
            });
        }
        Ok(())
    }
    /// Validation and copying perform no allocation on success. Publish the
    /// completed schedule atomically through the adapter's ownership mechanism.
    pub fn replace(&mut self, points: &[GainPoint]) -> Result<()> {
        Self::validate(points)?;
        self.points[..points.len()].copy_from_slice(points);
        self.len = points.len();
        Ok(())
    }
    pub fn points(&self) -> &[GainPoint] {
        &self.points[..self.len]
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_validation_and_replacement_are_atomic() {
        let mut schedule = GainSchedule::default();
        let initial = schedule.points().to_vec();
        for points in [
            vec![],
            vec![GainPoint {
                source_frame: 1,
                linear: 1.0,
            }],
            vec![GainPoint {
                source_frame: 0,
                linear: f32::NAN,
            }],
            vec![GainPoint {
                source_frame: 0,
                linear: 1001.0,
            }],
            vec![GainPoint::default(), GainPoint::default()],
            vec![GainPoint::default(); MAX_GAIN_POINTS + 1],
        ] {
            assert!(schedule.replace(&points).is_err());
            assert_eq!(schedule.points(), initial);
        }
        schedule
            .replace(&[
                GainPoint::default(),
                GainPoint {
                    source_frame: 44100,
                    linear: 0.5,
                },
            ])
            .unwrap();
        assert_eq!(schedule.points().len(), 2);
    }
}
