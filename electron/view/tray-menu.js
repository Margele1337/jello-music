// 托盘自绘菜单的页面脚本（从 tray-menu.html 外置，以便 CSP 用 script-src 而不需要 unsafe-inline）。
        // 显示/收起放首位（托盘菜单最常用的动作），设置次之，退出程序固定末位
        const actionOrder = [
            'show-hide',
            'settings',
            'check-updates',
            'project-home',
            'restart-app',
            'quit'
        ];

        const labelMap = {
            'project-home': 'projectHome',
            'settings': 'settings',
            'check-updates': 'checkUpdates',
            'prev-track': 'prevTrack',
            'toggle-play-pause': 'playPause',
            'next-track': 'nextTrack',
            'restart-app': 'restartApp',
            'show-hide': 'showHide',
            'quit': 'quit'
        };

        const iconMap = {
            'show-hide': 'window',
            'settings': 'settings',
            'check-updates': 'rotate',
            'project-home': 'house',
            'restart-app': 'power',
            'quit': 'logout'
        };

        const dangerActions = new Set(['quit']);
        let currentState = null;
        let progressTimer = null;

        const iconSvg = (name) => {
            const icons = {
                house: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.25 3.75 10v10.75h6.5v-6h3.5v6h6.5V10L12 3.25Zm0 2.58 6 4.91v8.51h-2.5v-6h-8v6H5V10.74l7-5.91Z"/></svg>',
                backward: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.75a.75.75 0 0 1 1.2.6v9.3a.75.75 0 0 1-1.2.6l-6.11-4.65a.75.75 0 0 1 0-1.2L19 6.75Zm-8 0a.75.75 0 0 1 1.2.6v9.3a.75.75 0 0 1-1.2.6l-6.11-4.65a.75.75 0 0 1 0-1.2L11 6.75Z"/></svg>',
                forward: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6.75a.75.75 0 0 0-1.2.6v9.3a.75.75 0 0 0 1.2.6l6.11-4.65a.75.75 0 0 0 0-1.2L5 6.75Zm8 0a.75.75 0 0 0-1.2.6v9.3a.75.75 0 0 0 1.2.6l6.11-4.65a.75.75 0 0 0 0-1.2L13 6.75Z"/></svg>',
                play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.25 5.18a.75.75 0 0 1 1.12-.65l8.5 5a.75.75 0 0 1 0 1.3l-8.5 5a.75.75 0 0 1-1.12-.65V5.18Z"/></svg>',
                pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.25 5A1.25 1.25 0 0 1 9.5 6.25v11.5A1.25 1.25 0 0 1 8.25 19h-.5A1.25 1.25 0 0 1 6.5 17.75V6.25A1.25 1.25 0 0 1 7.75 5h.5Zm8 0a1.25 1.25 0 0 1 1.25 1.25v11.5A1.25 1.25 0 0 1 16.25 19h-.5a1.25 1.25 0 0 1-1.25-1.25V6.25A1.25 1.25 0 0 1 15.75 5h.5Z"/></svg>',
                rotate: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4a7.98 7.98 0 0 1 6.16 2.9V5.75a.75.75 0 0 1 1.5 0V9a.75.75 0 0 1-.75.75h-3.25a.75.75 0 0 1 0-1.5h1.54A6.5 6.5 0 1 0 18.5 12a.75.75 0 0 1 1.5 0A8 8 0 1 1 12 4Z"/></svg>',
                power: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.75a.75.75 0 0 1 .75.75v7a.75.75 0 0 1-1.5 0v-7a.75.75 0 0 1 .75-.75Zm4.95 2.57a.75.75 0 0 1 1.06 1.06 7 7 0 1 1-12.02 4.95 6.96 6.96 0 0 1 2.05-4.95A.75.75 0 0 1 9.1 7.44a5.5 5.5 0 1 0 7.85 0Z"/></svg>',
                window: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.25A2.25 2.25 0 0 1 6.25 3h11.5A2.25 2.25 0 0 1 20 5.25v13.5A2.25 2.25 0 0 1 17.75 21H6.25A2.25 2.25 0 0 1 4 18.75V5.25Zm1.5 2.25h13v-2.25a.75.75 0 0 0-.75-.75H6.25a.75.75 0 0 0-.75.75V7.5Zm13 1.5h-13v9.75c0 .41.34.75.75.75h11.5a.75.75 0 0 0 .75-.75V9Z"/></svg>',
                logout: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.25 3A2.25 2.25 0 0 0 7 5.25v13.5A2.25 2.25 0 0 0 9.25 21h5a.75.75 0 0 0 0-1.5h-5a.75.75 0 0 1-.75-.75V5.25A.75.75 0 0 1 9.25 4.5h5a.75.75 0 0 0 0-1.5h-5Zm7.03 5.22a.75.75 0 0 0-1.06 1.06l1.97 1.97H11.75a.75.75 0 0 0 0 1.5h5.44l-1.97 1.97a.75.75 0 1 0 1.06 1.06l3.25-3.25a.75.75 0 0 0 0-1.06l-3.25-3.25Z"/></svg>',
                music: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.25 3.5a.75.75 0 0 1 .75.75v9.69A3.75 3.75 0 1 1 15.5 11V7.12l-6 1.5v7.32A3.75 3.75 0 1 1 8 13V6.75c0-.34.23-.63.56-.71l7.5-1.88a.75.75 0 0 1 .19-.02Z"/></svg>',
                settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.25A3.75 3.75 0 1 0 15.75 12 3.75 3.75 0 0 0 12 8.25Zm0 6A2.25 2.25 0 1 1 14.25 12 2.25 2.25 0 0 1 12 14.25Zm8.06-3.4.94-.73a.75.75 0 0 0 .2-.96l-1.5-2.6a.75.75 0 0 0-.9-.32l-1.13.4a7.6 7.6 0 0 0-1.32-.76l-.19-1.19a.75.75 0 0 0-.74-.63h-3a.75.75 0 0 0-.74.63l-.19 1.19a7.6 7.6 0 0 0-1.32.76l-1.13-.4a.75.75 0 0 0-.9.32l-1.5 2.6a.75.75 0 0 0 .2.96l.94.73a7.7 7.7 0 0 0 0 1.53l-.94.73a.75.75 0 0 0-.2.96l1.5 2.6a.75.75 0 0 0 .9.32l1.13-.4a7.6 7.6 0 0 0 1.32.76l.19 1.19a.75.75 0 0 0 .74.63h3a.75.75 0 0 0 .74-.63l.19-1.19a7.6 7.6 0 0 0 1.32-.76l1.13.4a.75.75 0 0 0 .9-.32l1.5-2.6a.75.75 0 0 0-.2-.96l-.94-.73a7.7 7.7 0 0 0 0-1.53Z"/></svg>'
            };

            return `<span class="icon">${icons[name] || icons.music}</span>`;
        };

        const escapeHtml = (value) => String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');

        const getPlayIconName = () => currentState?.isPlaying ? 'pause' : 'play';

        const formatTime = (seconds) => {
            const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
            const minutes = Math.floor(safeSeconds / 60).toString().padStart(2, '0');
            const restSeconds = (safeSeconds % 60).toString().padStart(2, '0');
            return `${minutes}:${restSeconds}`;
        };

        const stopProgressTimer = () => {
            if (!progressTimer) return;
            clearInterval(progressTimer);
            progressTimer = null;
        };

        const tickProgress = () => {
            const song = currentState?.song;
            if (!currentState?.isPlaying || !song) {
                stopProgressTimer();
                return;
            }

            const duration = Number(song.duration) || 0;
            const currentTime = Number(song.currentTime) || 0;
            const nextTime = duration > 0 ? Math.min(currentTime + 1, duration) : currentTime + 1;

            song.currentTime = nextTime;
            song.currentTimeText = formatTime(nextTime);
            song.progressPercent = duration > 0 ? Math.max(0, Math.min((nextTime / duration) * 100, 100)) : 0;
            renderSong();

            if (duration > 0 && nextTime >= duration) {
                stopProgressTimer();
            }
        };

        const syncProgressTimer = () => {
            stopProgressTimer();
            if (!currentState?.isPlaying || !currentState?.song) return;
            progressTimer = setInterval(tickProgress, 1000);
        };

        const renderControls = () => {
            document.getElementById('prevControl').innerHTML = iconSvg('backward');
            document.getElementById('playControl').innerHTML = iconSvg(getPlayIconName());
            document.getElementById('nextControl').innerHTML = iconSvg('forward');
        };

        const renderSong = () => {
            const song = currentState?.song;
            const labels = currentState?.labels || {};
            const coverEl = document.getElementById('cover');

            if (!song) {
                coverEl.innerHTML = iconSvg('music');
                document.getElementById('songTitle').textContent = labels.noSong || 'Jello Music';
                document.getElementById('songArtist').textContent = 'Jello Music';
                document.getElementById('progressFill').style.width = '0%';
                document.getElementById('currentTime').textContent = '00:00';
                document.getElementById('durationTime').textContent = '00:00';
                return;
            }

            if (song.cover) {
                coverEl.innerHTML = `<img src="${escapeHtml(song.cover)}" alt="">`;
            } else {
                coverEl.innerHTML = iconSvg('music');
            }

            document.getElementById('songTitle').textContent = song.title || 'Jello Music';
            document.getElementById('songArtist').textContent = song.artist || 'Jello';
            document.getElementById('progressFill').style.width = `${song.progressPercent || 0}%`;
            document.getElementById('currentTime').textContent = song.currentTimeText || '00:00';
            document.getElementById('durationTime').textContent = song.durationText || '00:00';
        };

        const renderActions = () => {
            const labels = currentState?.labels || {};
            const actionList = document.getElementById('actionList');

            actionList.innerHTML = actionOrder.map((action) => {
                const isDanger = dangerActions.has(action);
                const label = labels[labelMap[action]] || action;

                return `
                    <button class="action-item${isDanger ? ' danger' : ''}" type="button" data-action="${action}">
                        <span class="action-icon">${iconSvg(iconMap[action])}</span>
                        <span class="action-label">${escapeHtml(label)}</span>
                    </button>
                `;
            }).join('');
        };

        const render = () => {
            renderControls();
            renderSong();
            renderActions();
        };

        const sendAction = (action) => {
            window.jelloTray?.sendAction?.(action);
        };

        // Windows 上托盘弹出的菜单常常拿不到前台焦点：mousedown 与 mouseup 之间
        // 一旦失焦（blur 会立即 hide），click 事件根本不会触发，表现为「点了没反应」。
        // 因此在 pointerdown 派发——它一定早于任何失焦与隐藏。
        document.addEventListener('pointerdown', (event) => {
            const actionButton = event.target.closest('[data-action]');
            if (!actionButton) return;
            console.info('[tray-menu] pointerdown 命中动作', actionButton.dataset.action);
            sendAction(actionButton.dataset.action);
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                window.jelloTray?.hide?.();
            }
        });

        window.jelloTray?.onState?.((state) => {
            currentState = state;
            render();
            syncProgressTimer();
            if (state?.renderToken) {
                requestAnimationFrame(() => {
                    window.jelloTray?.rendered?.(state.renderToken);
                });
            }
        });

        window.addEventListener('DOMContentLoaded', () => {
            render();
            window.jelloTray?.ready?.();
        });

        window.addEventListener('beforeunload', stopProgressTimer);
