use super::*;
use std::time::SystemTime;

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("md-viewer-{}-{nonce}", std::process::id()));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn selected_files_are_read_only_bounded_and_fail_cleanly_when_removed() {
    let fixture = Fixture::new();
    let root = fs::canonicalize(&fixture.0).unwrap();
    let document = root.join("한글.md");
    let content = "# 읽기 전용";
    fs::write(&document, content).unwrap();
    fs::create_dir(root.join("node_modules")).unwrap();
    fs::write(root.join("node_modules/hidden.md"), "outside index").unwrap();
    let modified = fs::metadata(&document).unwrap().modified().unwrap();
    let grant = Grant {
        id: 1,
        paths: scan(&root).unwrap(),
        root,
    };
    assert_eq!(grant.paths, HashSet::from(["한글.md".to_owned()]));
    assert!(read_granted(&grant, "한글.md", 1024).is_ok());
    assert!(read_granted(&grant, "한글.md", 2)
        .err()
        .unwrap()
        .contains("20 MiB"));
    assert!(read_granted(&grant, "../secret.md", 1024).is_err());
    assert_eq!(fs::read_to_string(&document).unwrap(), content);
    assert_eq!(
        fs::metadata(&document).unwrap().modified().unwrap(),
        modified
    );
    fs::remove_file(document).unwrap();
    assert!(read_granted(&grant, "한글.md", 1024).is_err());
}

#[cfg(windows)]
#[test]
fn a_junction_cannot_replace_an_approved_subdirectory() {
    use std::process::Command;
    let fixture = Fixture::new();
    let root = fs::canonicalize(&fixture.0).unwrap();
    let selected = root.join("selected");
    let outside = root.join("outside");
    let docs = selected.join("docs");
    fs::create_dir_all(&docs).unwrap();
    fs::create_dir(&outside).unwrap();
    fs::write(docs.join("guide.md"), "inside").unwrap();
    fs::write(outside.join("guide.md"), "outside").unwrap();
    let grant = Grant {
        id: 1,
        paths: scan(&selected).unwrap(),
        root: selected.clone(),
    };
    assert!(read_granted(&grant, "docs/guide.md", 1024).is_ok());
    fs::remove_file(docs.join("guide.md")).unwrap();
    fs::remove_dir(&docs).unwrap();
    let result = Command::new("cmd.exe")
        .args(["/d", "/c", "mklink", "/j", "selected\\docs", "outside"])
        .current_dir(&fixture.0)
        .output()
        .unwrap();
    assert!(result.status.success(), "{:?}", result);
    assert!(fs::read_to_string(docs.join("guide.md")).is_ok());
    assert!(scan(&selected).unwrap().is_empty());
    assert!(read_granted(&grant, "docs/guide.md", 1024).is_err());
    fs::remove_dir(docs).unwrap();
}
