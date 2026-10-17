import '@fontsource-variable/nunito';
import '@fontsource-variable/jetbrains-mono';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import orderCodeMark from '../../../brand/LogoSinFondo.png';

const favicon = document.createElement('link');
favicon.rel = 'icon';
favicon.type = 'image/png';
favicon.href = orderCodeMark;
document.head.append(favicon);

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
