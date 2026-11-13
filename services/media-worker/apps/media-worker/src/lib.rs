//! Library surface for the media worker. The binary (`src/main.rs`) owns
//! startup and shutdown; everything else lives here so black-box integration
//! tests can exercise the job lifecycle without launching the worker.

pub mod config;
pub mod heartbeat;
pub mod jobs;
pub mod queue;
pub mod s3;
pub mod worker;
