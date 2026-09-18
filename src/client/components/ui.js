function showView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById('view-' + view);
  if (el) el.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const nav = document.querySelector(`.nav-item[data-view="${view}"]`);
  if (nav) nav.classList.add('active');
  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('mobile-overlay').classList.add('hidden');
  }
}

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('mobile-overlay');
  sb.classList.toggle('open');
  ov.classList.toggle('hidden');
}

function showToast(msg, type) {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = 'toast toast-' + (type || 'info');
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3000);
}

function setPreset(cat) {
  const presets = {
    education: 'Đại học hay đi làm sớm?',
    career: 'Có nên chuyển ngành sang AI không?',
    technology: 'AI có làm thay đổi nghề lập trình trong 5 năm tới không?',
    business: 'Startup nên tập trung sản phẩm hay doanh thu trước?',
    personal: 'Có nên mua PC 20 triệu để học AI không?',
    society: 'Mạng xã hội có đang làm giảm khả năng tư duy phản biện?',
    science: 'Năng lượng hạt nhân có phải giải pháp tốt nhất cho biến đổi khí hậu?'
  };
  const input = document.getElementById('question-input');
  if (input && presets[cat]) input.value = presets[cat];
}

function loadDemo(idx) {
  const demos = [
    'Có nên mua PC 20 triệu để học AI không?',
    'Đại học hay đi làm sớm?',
    'AI có làm thay đổi nghề lập trình trong 5 năm tới không?',
    'Startup nên tập trung sản phẩm hay doanh thu trước?',
    'Có nên học nhiều kỹ năng cùng lúc hay tập trung một kỹ năng?'
  ];
  const input = document.getElementById('question-input');
  if (input && demos[idx]) input.value = demos[idx];
}
