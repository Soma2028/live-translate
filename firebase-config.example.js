// Firebaseコンソール > プロジェクトの設定 > 全般 > マイアプリ から
// ウェブアプリの設定値をコピーしてくる。
//
// このファイルをコピーして firebase-config.js を作ること。
// firebase-config.js は .gitignore 対象なのでコミットされない。
//
//   cp firebase-config.example.js firebase-config.js
//
// Realtime Database を有効化し、databaseURL も忘れず入れること。

export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  databaseURL: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};
