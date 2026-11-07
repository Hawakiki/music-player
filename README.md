# music-player

## 개발

```sh
npm install
npm run dev      # 개발 서버
npm run lint     # oxlint
npm run build    # 타입 검사 + 빌드 (dist/)
npm run preview  # 빌드 결과 확인
```

UI 컴포넌트 추가: `npx shadcn@latest add <component>`

## 시험

```sh
npm run build
npm run test:e2e -- --songs <곡 폴더>                # 전체
npm run test:e2e -- --songs <곡 폴더> --only 8,16    # 일부
npm run test:e2e -- --songs <곡 폴더> --long <파일>  # 아주 긴 파일 시험 포함
```

- 필요: ffmpeg, Edge, Chrome
- 곡 폴더에는 `tests/run.mjs`의 `SONGS`에 적힌 FLAC이 있어야 한다. 시험 파일은 이 곡들에서 만들어 `tests/out`에 둔다.
- 음원은 저장소에 올리지 않는다. 오디오 확장자는 `.gitignore`로 막혀 있다.

## 배포

`main`에 push하면 GitHub Actions가 빌드해서 GitHub Pages에 올린다.
