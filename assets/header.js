window.addEventListener('load', () => {
  const header = document.getElementById('header');
  const sidebar = document.getElementById('sidebar');

  // TODO: Update text size

  // Include a toggle for terminal mode
  document.body.addEventListener('keydown', (evt) => {
    if (evt.ctrlKey && evt.key === 't'){
      if (document.body.classList.contains('terminal-mode')){
        header.style.display = 'flex';
        sidebar.classList.remove('hidden');
        return document.body.classList.remove('terminal-mode');
      }

      header.style.display = 'none';
      sidebar.classList.add('hidden');
      document.body.classList.add('terminal-mode');
    }
  });
});