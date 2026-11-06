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

## 배포

`main`에 push하면 GitHub Actions가 빌드해서 GitHub Pages에 올린다.
