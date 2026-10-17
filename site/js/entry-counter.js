// 純裝飾：暱稱輸入框旁的字數計數（例如 3 / 20）。
// 與 ui.js 各自獨立，只讀取輸入框的內容，不影響任何驗證或送出邏輯。

const input = document.getElementById('nickname-input');
const counter = document.getElementById('nickname-counter');
const MAX = 20;

if (input && counter) {
  const update = () => {
    const count = [...input.value.trim()].length;
    counter.textContent = `${count} / ${MAX}`;
    counter.classList.toggle('field__counter--over', count > MAX);
  };
  input.addEventListener('input', update);
  update();
}
