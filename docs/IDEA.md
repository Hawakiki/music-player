# 뮤직 플레이어 아이디어

2026-11-05 대화 정리. 브라우저 지원 범위는 대화 당시 지식 기준이라 구현할 때 다시 확인한다.

## 목표

- 사용자가 지정한 로컬 음악 폴더를 브라우저에서 재생하는 웹 플레이어
- 백엔드 없는 정적 사이트, GitHub Pages(github.io) 배포
- 지정한 폴더(여러 개)를 기억하고, 다시 오면 자동으로 연결
- 설정, 재생목록 등은 브라우저에 저장

## 결정한 것

| 항목 | 결정 |
|---|---|
| 스택 | Vite + React + TypeScript, Tailwind CSS, shadcn/ui |
| 라우팅 | `HashRouter` (GitHub Pages에서 새로고침 404 방지) |
| 빌드 경로 | `base: './'` (저장소 이름에 묶이지 않게) |
| UI 디자인 | frontend-design 스킬을 로드하고 작업 |
| 폴더 선택 | `showDirectoryPicker()` 기본, 미지원 브라우저는 `webkitdirectory`로 대체 |
| 파일 추가 | 드래그 앤 드롭은 항상 켜 둠 |
| 폴더 핸들, 재생목록, 메타데이터 캐시 | IndexedDB |
| 볼륨, 테마, 셔플/반복, 마지막 재생 위치 | localStorage |
| 데이터 보호 | `navigator.storage.persist()` 요청 |
| 재생목록 백업 | JSON 내보내기/가져오기 |
| 자동 재연결 범위 | Chrome/Edge만. Firefox/Safari는 매번 폴더를 다시 선택 |
| 쿠키 | 사용 안 함 (서버가 없음) |

## github.io에서 파일/폴더를 읽을 수 있나

된다. github.io는 정적 파일만 내려주고 파일 읽기는 브라우저에서 처리한다. 사용자가 직접 고른 파일/폴더만 읽을 수 있고, 경로 지정 접근은 불가능하다.

| 방식 | 할 수 있는 것 | 브라우저 | 재방문 시 |
|---|---|---|---|
| 드래그 앤 드롭 (`dataTransfer`) | 파일, `webkitGetAsEntry()`로 폴더도 가능 | 전부 | 다시 끌어와야 함 |
| `<input type="file" webkitdirectory>` | 폴더 선택, 하위 파일까지 읽기 | 전부 (데스크톱 기준) | 다시 선택해야 함 |
| `showDirectoryPicker()` | 폴더 핸들로 읽기/쓰기 | Chrome/Edge 계열만 | 핸들 저장 후 권한 확인만으로 재접근 |
| OPFS | 브라우저 전용 저장소에 파일 복사 | 전부 | 유지됨 (용량 차지) |

- 재생: `URL.createObjectURL(file)`을 `<audio>`에 연결
- 태그/앨범아트: `music-metadata` 같은 라이브러리로 브라우저에서 읽기
- 파일이 서버로 올라가지 않으므로 백엔드 불필요

### GitHub Pages 주의점

- 응답 헤더를 직접 설정할 수 없다. `SharedArrayBuffer`가 필요한 기능(멀티스레드 ffmpeg.wasm 등)은 우회가 필요하다. 일반 재생과는 무관하다.
- `hawakiki.github.io/저장소이름` 형태의 페이지들은 같은 origin이라 IndexedDB와 OPFS를 공유한다. 키/DB 이름이 다른 페이지와 겹치지 않게 접두어를 쓴다.

## 브라우저 저장소는 얼마나 유지되나

쿠키만 기간이 있고 나머지는 만료가 없어 반영구급이다.

| 저장소 | 저장 기간 | 용량 |
|---|---|---|
| 쿠키 | 지정한 만료일까지 (Chrome 최대 400일, Safari는 JS로 만든 쿠키 최대 7일) | 약 4KB |
| localStorage | 만료 없음 | 약 5MB |
| IndexedDB | 만료 없음 | 디스크의 상당 부분 (브라우저마다 다름) |
| OPFS | 만료 없음 | IndexedDB와 같은 할당량 공유 |

만료가 없어도 지워지는 경우:

- 사용자가 사이트 데이터나 인터넷 사용 기록을 삭제할 때
- 디스크 부족으로 브라우저가 오래 안 쓴 사이트부터 정리할 때 (`persist()` 승인 시 제외)
- 시크릿 모드를 닫을 때
- Safari에서 7일간 방문이 없을 때 (홈 화면에 설치한 웹앱은 예외)

음악 파일은 사용자 폴더에 그대로 있고 DB에는 참조만 들어간다. DB가 날아가도 폴더를 다시 고르면 복구되지만, 재생목록은 복구가 안 되므로 JSON 내보내기를 둔다.

## 지정한 폴더를 기억하고 자동으로 다시 연결할 수 있나

가능하다. 다만 localStorage는 문자열만 저장되어 폴더 핸들을 넣을 수 없으므로 IndexedDB를 쓴다.

| 시점 | 사용자 동작 | 결과 |
|---|---|---|
| 첫 방문 | 폴더 선택 | 핸들을 IndexedDB에 저장 |
| 두 번째 방문 | "다시 연결" 버튼 클릭 | 권한 창에서 "방문할 때마다 허용" 선택 |
| 그 이후 | 없음 | 페이지만 열면 자동 연결 |

`requestPermission()`은 사용자 클릭 안에서만 동작하므로 두 번째 방문에는 클릭이 필요하다. 완전 자동은 "방문할 때마다 허용"을 고른 뒤부터다 (Chrome 122 이상).

```ts
for (const handle of savedHandles) {
  const state = await handle.queryPermission({ mode: 'read' })
  if (state === 'granted') connect(handle)  // 자동 연결
  else showReconnectButton(handle)          // 클릭 시 requestPermission()
}
```

처리할 예외:

- 폴더 이동/삭제: 접근 시 `NotFoundError`가 나므로 "연결 끊김"으로 표시하고 다시 고르게 한다.
- 권한 해제: 자동 연결이 되더라도 "다시 연결" 버튼은 남겨 둔다.
- 중복 폴더: `isSameEntry()`로 같은 폴더인지 확인한다.

Firefox/Safari는 폴더 핸들이 없어 자동 재연결이 안 된다. 매번 다시 고르거나 곡을 OPFS로 복사해야 하는데, 이번 범위에서는 다시 고르는 쪽으로 간다.
