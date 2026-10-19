//! Bounded, protocol-neutral JSONL framing. No process or conversation state.

use serde_json::{Map, Value};
use std::fmt;
use std::io::{self, Write};

#[derive(Debug)]
pub enum TransportError {
    FrameTooLong { limit: usize },
    InvalidUtf8(std::str::Utf8Error),
    InvalidJson(serde_json::Error),
    NonObject,
    TruncatedEof,
    Closed,
}

impl fmt::Display for TransportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::FrameTooLong { limit } => write!(f, "JSONL frame exceeds {limit} bytes"),
            Self::InvalidUtf8(error) => write!(f, "Invalid JSONL UTF-8: {error}"),
            Self::InvalidJson(error) => write!(f, "Invalid JSONL JSON: {error}"),
            Self::NonObject => f.write_str("JSONL record must be an object"),
            Self::TruncatedEof => f.write_str("JSONL stream ended before LF"),
            Self::Closed => f.write_str("JSONL decoder is closed"),
        }
    }
}

impl std::error::Error for TransportError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::InvalidUtf8(error) => Some(error),
            Self::InvalidJson(error) => Some(error),
            _ => None,
        }
    }
}

/// The limit counts wire bytes before LF, including the optional CR in CRLF.
/// Records are delivered immediately rather than collected into an unbounded batch.
/// An error closes the decoder; records delivered before that error remain delivered.
pub struct JsonlDecoder {
    limit: usize,
    pending: Vec<u8>,
    closed: bool,
}

impl JsonlDecoder {
    pub fn new(limit: usize) -> Self {
        Self {
            limit,
            pending: Vec::new(),
            closed: false,
        }
    }

    pub fn feed(
        &mut self,
        mut bytes: &[u8],
        mut on_record: impl FnMut(Map<String, Value>),
    ) -> Result<(), TransportError> {
        if self.closed {
            return Err(TransportError::Closed);
        }
        while !bytes.is_empty() {
            let lf = bytes.iter().position(|byte| *byte == b'\n');
            let length = lf.unwrap_or(bytes.len());
            if length > self.limit - self.pending.len() {
                return self.fail(TransportError::FrameTooLong { limit: self.limit });
            }
            self.pending.reserve_exact(length);
            self.pending.extend_from_slice(&bytes[..length]);
            if lf.is_none() {
                break;
            }
            let record = (|| {
                // Validate encoding separately so callers receive a typed UTF-8 error.
                let text =
                    std::str::from_utf8(&self.pending).map_err(TransportError::InvalidUtf8)?;
                let text = text.strip_suffix('\r').unwrap_or(text);
                match serde_json::from_str(text).map_err(TransportError::InvalidJson)? {
                    Value::Object(object) => Ok(object),
                    _ => Err(TransportError::NonObject),
                }
            })();
            match record {
                Ok(object) => {
                    self.pending.clear();
                    on_record(object);
                }
                Err(error) => return self.fail(error),
            }
            bytes = &bytes[length + 1..];
        }
        Ok(())
    }

    /// EOF requires a terminating LF even when the buffered JSON is complete.
    pub fn finish(&mut self) -> Result<(), TransportError> {
        if self.closed {
            return Err(TransportError::Closed);
        }
        self.closed = true;
        if self.pending.is_empty() {
            Ok(())
        } else {
            self.pending.clear();
            Err(TransportError::TruncatedEof)
        }
    }

    fn fail<T>(&mut self, error: TransportError) -> Result<T, TransportError> {
        self.pending.clear();
        self.closed = true;
        Err(error)
    }
}

struct BoundedWriter {
    bytes: Vec<u8>,
    limit: usize,
    exceeded: bool,
}

impl Write for BoundedWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > self.limit - self.bytes.len() {
            self.exceeded = true;
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "JSONL limit exceeded",
            ));
        }
        self.bytes.reserve_exact(bytes.len());
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// Serialize one object with a trailing LF. The limit excludes that trailing LF.
/// Serialization itself is bounded; no oversized intermediate JSON string is built.
pub fn encode_command(command: &Value, limit: usize) -> Result<Vec<u8>, TransportError> {
    if !command.is_object() {
        return Err(TransportError::NonObject);
    }
    let mut writer = BoundedWriter {
        bytes: Vec::new(),
        limit,
        exceeded: false,
    };
    if let Err(error) = serde_json::to_writer(&mut writer, command) {
        return Err(if writer.exceeded {
            TransportError::FrameTooLong { limit }
        } else {
            TransportError::InvalidJson(error)
        });
    }
    writer.bytes.reserve_exact(1);
    writer.bytes.push(b'\n');
    Ok(writer.bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn fragmented_utf8_crlf_and_multiple_records() {
        let wire = "{\"text\":\"雪\u{2028}line\"}\r\n{\"id\":2}\n";
        for split in 0..=wire.len() {
            let mut decoder = JsonlDecoder::new(128);
            let mut records = Vec::new();
            decoder
                .feed(&wire.as_bytes()[..split], |r| {
                    records.push(Value::Object(r))
                })
                .unwrap();
            decoder
                .feed(&wire.as_bytes()[split..], |r| {
                    records.push(Value::Object(r))
                })
                .unwrap();
            decoder.finish().unwrap();
            assert_eq!(
                records,
                vec![json!({"text": "雪\u{2028}line"}), json!({"id": 2})]
            );
        }
    }

    #[test]
    fn bytewise_and_interleaved_streams_are_independent() {
        let mut first = JsonlDecoder::new(32);
        let mut second = JsonlDecoder::new(32);
        let mut a = Vec::new();
        let mut b = Vec::new();
        for (left, right) in b"{\"id\":1}\n".iter().zip(b"{\"id\":2}\n") {
            first.feed(&[*left], |r| a.push(Value::Object(r))).unwrap();
            second
                .feed(&[*right], |r| b.push(Value::Object(r)))
                .unwrap();
        }
        first.finish().unwrap();
        second.finish().unwrap();
        assert_eq!(a, vec![json!({"id": 1})]);
        assert_eq!(b, vec![json!({"id": 2})]);
    }

    #[test]
    fn limit_is_incremental_and_counts_cr_not_lf() {
        let mut decoder = JsonlDecoder::new(2);
        decoder.feed(b"{", |_| panic!()).unwrap();
        decoder.feed(b"}", |_| panic!()).unwrap();
        let mut count = 0;
        decoder.feed(b"\n{}\n", |_| count += 1).unwrap();
        assert_eq!(count, 2);
        decoder.feed(b"{}", |_| panic!()).unwrap();
        assert!(matches!(
            decoder.feed(b"\r", |_| panic!()),
            Err(TransportError::FrameTooLong { limit: 2 })
        ));
        assert!(decoder.pending.is_empty());
        assert!(matches!(
            decoder.feed(b"\n", |_| panic!()),
            Err(TransportError::Closed)
        ));
        let mut crlf = JsonlDecoder::new(3);
        crlf.feed(b"{}\r\n", |_| {}).unwrap();
        crlf.finish().unwrap();
    }

    #[test]
    fn oversized_unterminated_chunk_is_not_buffered() {
        let mut decoder = JsonlDecoder::new(8);
        assert!(matches!(
            decoder.feed(&[b' '; 1024], |_| panic!()),
            Err(TransportError::FrameTooLong { limit: 8 })
        ));
        assert_eq!(decoder.pending.capacity(), 0);
        assert!(matches!(decoder.finish(), Err(TransportError::Closed)));
    }

    #[test]
    fn rejects_invalid_utf8_and_json() {
        for wire in [b"{\"x\":\"\xff\"}\n".as_slice(), b"\xc0\xaf\n"] {
            assert!(matches!(
                JsonlDecoder::new(64).feed(wire, |_| panic!()),
                Err(TransportError::InvalidUtf8(_))
            ));
        }
        for wire in [
            b"\n".as_slice(),
            b"\r\n",
            b"{]\n",
            b"{}{}\n",
            b"{\"x\":NaN}\n",
            b"{}\r{}\n",
            b"{}\xe2\x80\xa8{}\n",
        ] {
            assert!(matches!(
                JsonlDecoder::new(64).feed(wire, |_| panic!()),
                Err(TransportError::InvalidJson(_))
            ));
        }
    }

    #[test]
    fn rejects_every_nonobject_kind() {
        for wire in ["null\n", "true\n", "1\n", "\"text\"\n", "[]\n"] {
            assert!(matches!(
                JsonlDecoder::new(64).feed(wire.as_bytes(), |_| panic!()),
                Err(TransportError::NonObject)
            ));
        }
    }

    #[test]
    fn eof_requires_lf_and_closes_decoder() {
        for wire in [b"{".as_slice(), b"{}", b"{}\r", b"\xe9"] {
            let mut decoder = JsonlDecoder::new(64);
            decoder.feed(wire, |_| panic!()).unwrap();
            assert!(matches!(
                decoder.finish(),
                Err(TransportError::TruncatedEof)
            ));
            assert!(matches!(decoder.finish(), Err(TransportError::Closed)));
        }
        let mut empty = JsonlDecoder::new(0);
        empty.feed(b"", |_| panic!()).unwrap();
        empty.finish().unwrap();
        assert!(matches!(
            empty.feed(b"", |_| panic!()),
            Err(TransportError::Closed)
        ));
    }

    #[test]
    fn delivers_prior_records_but_stops_at_first_error() {
        let mut decoder = JsonlDecoder::new(64);
        let mut count = 0;
        assert!(matches!(
            decoder.feed(b"{}\n[]\n{}\n", |_| count += 1),
            Err(TransportError::NonObject)
        ));
        assert_eq!(count, 1);
    }

    #[test]
    fn bounded_command_encoding_round_trips_escaped_content() {
        let command = json!({"text": "a\nb\r雪\u{2028}"});
        let expected = serde_json::to_vec(&command).unwrap();
        let wire = encode_command(&command, expected.len()).unwrap();
        assert_eq!(wire.len(), expected.len() + 1);
        assert_eq!(wire.iter().filter(|byte| **byte == b'\n').count(), 1);
        let mut records = Vec::new();
        let mut decoder = JsonlDecoder::new(expected.len());
        decoder
            .feed(&wire, |r| records.push(Value::Object(r)))
            .unwrap();
        decoder.finish().unwrap();
        assert_eq!(records, vec![command.clone()]);
        assert!(matches!(
            encode_command(&command, expected.len() - 1),
            Err(TransportError::FrameTooLong { .. })
        ));
    }

    #[test]
    fn command_limits_and_nonobjects() {
        assert_eq!(encode_command(&json!({}), 2).unwrap(), b"{}\n");
        for limit in [0, 1] {
            assert!(matches!(
                encode_command(&json!({}), limit),
                Err(TransportError::FrameTooLong { .. })
            ));
        }
        for value in [Value::Null, json!(false), json!(1), json!("x"), json!([])] {
            assert!(matches!(
                encode_command(&value, 64),
                Err(TransportError::NonObject)
            ));
        }
        let mut writer = BoundedWriter {
            bytes: Vec::new(),
            limit: 2,
            exceeded: false,
        };
        assert!(writer.write_all(&[b'x'; 1024]).is_err());
        assert_eq!(writer.bytes.capacity(), 0);
    }
}
