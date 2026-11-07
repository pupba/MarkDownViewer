# Markdown Viewer

PRESTIQUE LABS의 로컬 Markdown 열람 도구입니다. Windows 앱과 웹 버전은 같은 읽기 화면을 사용합니다.

## 문서 읽기

- **파일 열기**에서 UTF-8 또는 UTF-8 BOM으로 저장된 `.md`와 `.markdown` 파일을 엽니다.
- **폴더 열기**에서 연결된 문서와 이미지를 함께 엽니다. 왼쪽에서 문서를 선택하고 오른쪽에서 제목으로 이동할 수 있습니다. 좁은 창에서는 상단 버튼으로 두 패널을 엽니다.
- **문서 내 검색**에서 제목·본문·표·코드의 표시 텍스트를 찾습니다. Ctrl 또는 Cmd+F로 검색창을 열고, Enter와 Shift+Enter로 결과를 이동합니다. Esc로 검색을 닫습니다.
- **원본 다시 읽기**는 같은 파일을 다시 읽습니다. 브라우저의 대체 파일 선택기를 쓴 경우 파일 또는 폴더를 다시 선택합니다.
- 웹에서 폴더 선택 기능이 없는 환경에서는 단일 파일 열기를 사용합니다. 여러 파일을 드래그하면 파일명으로 열 수 있으며 원래 폴더 계층은 보존되지 않습니다.
- 첫 실행 때 제공되는 예제에서 표, 체크리스트, 목차, 상대 링크를 확인할 수 있습니다.

## 로컬 실행

Node.js 24와 npm을 사용합니다.

```sh
npm ci
npm run dev
```

브라우저에서 `http://127.0.0.1:1420`을 엽니다.

## GitHub Pages 배포

1. 이 폴더의 내용을 GitHub 저장소에 푸시합니다. `.github` 폴더와 두 잠금 파일을 함께 포함합니다.
2. 저장소 **Settings → Pages → Build and deployment → Source**에서 **GitHub Actions**를 선택합니다.
3. **Actions → Web checks and GitHub Pages**를 기본 브랜치에서 실행합니다. 이후 기본 브랜치에 푸시하면 검증을 거쳐 자동으로 배포됩니다. 배포 주소는 해당 실행의 `github-pages` 환경에 표시됩니다.

`npm run build`는 정적 웹 파일을 `dist/`에 생성합니다. 저장소명 하위 경로에서도 동작하도록 상대 주소를 사용합니다. [GitHub Pages 배포 설정](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

## Windows 11 x64 설치 프로그램

Rust stable의 MSVC 도구 체인, Visual Studio C++ Build Tools 및 Windows SDK, WebView2 런타임이 필요합니다. [Tauri 개발 환경 안내](https://v2.tauri.app/start/prerequisites/)

```powershell
npm ci
npm run desktop:build -- --target x86_64-pc-windows-msvc -- --locked
```

설치 프로그램은 `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`에 생성됩니다. GitHub에서도 **Actions → Windows x64 installer**를 실행하면 같은 종류의 설치 프로그램을 내려받을 수 있습니다. 현재 빌드는 서명 인증서 없이 생성합니다.

## 파일 접근 범위

문서와 이미지는 기기에서 읽습니다. 앱은 원본을 쓰거나 서버로 보내지 않습니다. 폴더를 선택한 경우 그 안의 Markdown 링크와 PNG, JPEG, GIF, WebP를 엽니다. 문서와 이미지는 각각 최대 20 MiB입니다. 외부 URL, 원격 이미지, SVG, raw HTML, 승인 범위를 벗어나는 파일 경로를 차단합니다. 검색 일치 위치는 최대 5,000개까지 표시합니다. 브라우저의 저장소에는 테마 설정만 보관합니다.

P0 열람 기능을 기준으로 구성했습니다. Mermaid, KaTeX, YAML 메타데이터, 최근 문서, 탭 및 폴더 전체 검색은 후속 범위입니다.

## 검사

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Windows 파일 접근 테스트는 `cargo test --locked --manifest-path src-tauri/Cargo.toml`로 실행합니다. BI 반영 내역과 화면 검수 기록은 [design](design/)에서 확인할 수 있습니다.
