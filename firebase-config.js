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
  apiKey: "AIzaSyD0C3ikhpynkELhTkt8PCagItolAkcYOLg",
  authDomain: "live-translate-e091c.firebaseapp.com",
  databaseURL: "https://live-translate-e091c-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "live-translate-e091c",
  storageBucket: "live-translate-e091c.firebasestorage.app",
  messagingSenderId: "956217183021",
  appId: "1:956217183021:web:08345bb43557af13f5a1a4"
};
