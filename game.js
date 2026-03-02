// Game state
let gameState = {
    score: 0,
    totalGames: 0,
    wins: 0,
    currentPrice: 0,
    startPrice: 0,
    prediction: null,
    roundPhase: 'waiting', // 'waiting' (5s), 'trading' (10s), 'result' (3s)
    timer: 5,
    roundTimer: null,
    chartData: [],
    ctx: null,
    animationFrame: null,
    roundStartPrice: 0,
    roundEndPrice: 0,
    canPredict: true
};

// PlayFun SDK
let sdk = null;
let sdkReady = false;

// Initialize PlayFun SDK
function initPlayFunSDK() {
    try {
        sdk = new OpenGameSDK({
            ui: {
                usePointsWidget: true,
                theme: 'dark'
            }
        });

        sdk.on('OnReady', () => {
            console.log('✅ PlayFun SDK Ready');
            sdkReady = true;
        });

        sdk.on('SavePointsSuccess', () => {
            console.log('✅ Points saved successfully!');
        });

        sdk.on('SavePointsFailed', () => {
            console.log('❌ Failed to save points');
        });

        sdk.init({ gameId: 'solymarket' })
            .then(() => {
                console.log('✅ PlayFun SDK Initialized');
            })
            .catch((error) => {
                console.error('❌ PlayFun SDK Init Error:', error);
            });
    } catch (error) {
        console.error('❌ PlayFun SDK not available:', error);
    }
}

// Binance WebSocket for real-time Solana price
const BINANCE_WS = 'wss://stream.binance.com:9443/ws/solusdt@trade';
let ws = null;

// Start when page loads
window.addEventListener('load', () => {
    createParticles();
    initChart();
    initPlayFunSDK(); // Initialize PlayFun SDK
    connectBinance();
    addButtonEffects();
    
    // Wait for first price then start automatic rounds
    setTimeout(() => {
        startAutomaticRounds();
    }, 2000);
});

// Create floating particles
function createParticles() {
    const particleCount = 30;
    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        particle.style.left = Math.random() * 100 + '%';
        particle.style.animationDelay = Math.random() * 15 + 's';
        particle.style.animationDuration = (Math.random() * 10 + 10) + 's';
        document.body.appendChild(particle);
    }
}

// Initialize Chart with advanced rendering
function initChart() {
    const canvas = document.getElementById('priceChart');
    gameState.ctx = canvas.getContext('2d');
    
    // Set canvas size with device pixel ratio for crisp rendering
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    gameState.ctx.scale(dpr, dpr);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    
    // Start animation loop
    animateChart();
}

// Advanced Chart Animation with smooth gradients and effects
function animateChart() {
    const ctx = gameState.ctx;
    const canvas = ctx.canvas;
    const width = canvas.width / (window.devicePixelRatio || 1);
    const height = canvas.height / (window.devicePixelRatio || 1);
    
    // Clear canvas completely
    ctx.fillStyle = 'rgba(10, 10, 15, 1)';
    ctx.fillRect(0, 0, width, height);
    
    // Only draw if we're in trading phase and have data
    if (gameState.roundPhase !== 'trading' || gameState.chartData.length < 2) {
        // Show "Waiting for round..." message
        if (gameState.roundPhase === 'waiting') {
            ctx.fillStyle = 'rgba(161, 161, 170, 0.6)';
            ctx.font = '16px Inter';
            ctx.textAlign = 'center';
            ctx.fillText('Waiting for round to start...', width / 2, height / 2);
        } else if (gameState.roundPhase === 'result') {
            ctx.fillStyle = 'rgba(161, 161, 170, 0.6)';
            ctx.font = '16px Inter';
            ctx.textAlign = 'center';
            ctx.fillText('Round ended - Next round starting soon...', width / 2, height / 2);
        }
        gameState.animationFrame = requestAnimationFrame(animateChart);
        return;
    }
    
    // Calculate min/max for scaling with padding
    const prices = gameState.chartData.map(d => d.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceRange = maxPrice - minPrice || 0.01;
    const padding = 50;
    const chartHeight = height - padding * 2;
    const chartWidth = width - padding * 2;
    
    // Draw grid with time labels
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.1)';
    ctx.lineWidth = 1;
    ctx.shadowBlur = 5;
    ctx.shadowColor = 'rgba(99, 102, 241, 0.3)';
    
    // Vertical time grid lines (0s, 2.5s, 5s, 7.5s, 10s)
    for (let i = 0; i <= 4; i++) {
        const x = padding + (chartWidth / 4) * i;
        ctx.beginPath();
        ctx.moveTo(x, padding);
        ctx.lineTo(x, height - padding);
        ctx.stroke();
        
        // Time labels
        const timeLabel = (i * 2.5).toFixed(1) + 's';
        ctx.fillStyle = 'rgba(161, 161, 170, 0.6)';
        ctx.font = '11px Inter';
        ctx.shadowBlur = 0;
        ctx.textAlign = 'center';
        ctx.fillText(timeLabel, x, height - padding + 20);
    }
    
    // Horizontal price grid lines
    for (let i = 0; i <= 5; i++) {
        const y = padding + (chartHeight / 5) * i;
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(width - padding, y);
        ctx.stroke();
        
        // Price labels
        const price = maxPrice - (priceRange / 5) * i;
        ctx.fillStyle = 'rgba(161, 161, 170, 0.6)';
        ctx.font = '11px Inter';
        ctx.shadowBlur = 0;
        ctx.textAlign = 'right';
        ctx.fillText('$' + price.toFixed(4), padding - 10, y + 4);
    }
    
    ctx.shadowBlur = 0;
    
    // Calculate points for smooth curve - map to full chart width based on time
    const roundStartTime = gameState.chartData[0].timestamp;
    const currentTime = Date.now();
    const elapsedTime = currentTime - roundStartTime;
    const totalRoundTime = 10000; // 10 seconds in milliseconds
    
    const points = gameState.chartData.map((point) => {
        // Calculate X position based on time elapsed (0 to 10 seconds)
        const pointElapsed = point.timestamp - roundStartTime;
        const timeProgress = Math.min(pointElapsed / totalRoundTime, 1); // 0 to 1
        const x = padding + (chartWidth * timeProgress);
        
        const normalizedPrice = (point.price - minPrice) / priceRange;
        const y = height - padding - (normalizedPrice * chartHeight);
        return { x, y, price: point.price };
    });
    
    // Draw smooth curve using quadratic curves
    ctx.strokeStyle = '#00d4ff';
    ctx.lineWidth = 3;
    ctx.shadowBlur = 15;
    ctx.shadowColor = '#00d4ff';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    
    if (points.length > 0) {
        ctx.moveTo(points[0].x, points[0].y);
        
        for (let i = 1; i < points.length; i++) {
            const prevPoint = points[i - 1];
            const currentPoint = points[i];
            const midX = (prevPoint.x + currentPoint.x) / 2;
            const midY = (prevPoint.y + currentPoint.y) / 2;
            
            ctx.quadraticCurveTo(prevPoint.x, prevPoint.y, midX, midY);
        }
        
        // Draw to last point
        const lastPoint = points[points.length - 1];
        ctx.lineTo(lastPoint.x, lastPoint.y);
    }
    
    ctx.stroke();
    
    // Draw gradient fill under the line
    const gradient = ctx.createLinearGradient(0, padding, 0, height - padding);
    gradient.addColorStop(0, 'rgba(0, 212, 255, 0.4)');
    gradient.addColorStop(0.5, 'rgba(0, 212, 255, 0.2)');
    gradient.addColorStop(1, 'rgba(0, 212, 255, 0)');
    
    ctx.fillStyle = gradient;
    ctx.shadowBlur = 0;
    ctx.beginPath();
    
    if (points.length > 0) {
        ctx.moveTo(points[0].x, points[0].y);
        
        for (let i = 1; i < points.length; i++) {
            const prevPoint = points[i - 1];
            const currentPoint = points[i];
            const midX = (prevPoint.x + currentPoint.x) / 2;
            const midY = (prevPoint.y + currentPoint.y) / 2;
            
            ctx.quadraticCurveTo(prevPoint.x, prevPoint.y, midX, midY);
        }
        
        const lastPoint = points[points.length - 1];
        ctx.lineTo(lastPoint.x, lastPoint.y);
        ctx.lineTo(lastPoint.x, height - padding);
        ctx.lineTo(points[0].x, height - padding);
        ctx.closePath();
        ctx.fill();
    }
    
    // Draw data points with glow
    points.forEach((point, index) => {
        // Draw every few points based on data density
        const skipFactor = Math.max(1, Math.floor(points.length / 20));
        if (index % skipFactor === 0 || index === points.length - 1) {
            ctx.beginPath();
            ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#00d4ff';
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#00d4ff';
            ctx.fill();
        }
    });
    
    ctx.shadowBlur = 0;
    
    // Draw start line (always at entry price during trading)
    if (gameState.roundPhase === 'trading' && gameState.roundStartPrice > 0) {
        const normalizedStart = (gameState.roundStartPrice - minPrice) / priceRange;
        const startY = height - padding - (normalizedStart * chartHeight);
        
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 5]);
        ctx.shadowBlur = 10;
        ctx.shadowColor = 'rgba(255, 255, 255, 0.5)';
        ctx.beginPath();
        ctx.moveTo(padding, startY);
        ctx.lineTo(width - padding, startY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.shadowBlur = 0;
        
        // Draw start price label with background
        ctx.fillStyle = 'rgba(99, 102, 241, 0.9)';
        const startLabelWidth = 120;
        ctx.fillRect(padding + 5, startY - 20, startLabelWidth, 18);
        ctx.fillStyle = 'white';
        ctx.font = 'bold 12px Inter';
        ctx.textAlign = 'left';
        ctx.fillText(`Entry: $${gameState.roundStartPrice.toFixed(4)}`, padding + 10, startY - 7);
        
        // Draw current price indicator
        if (gameState.chartData.length > 0) {
            const currentPrice = gameState.chartData[gameState.chartData.length - 1].price;
            const normalizedCurrent = (currentPrice - minPrice) / priceRange;
            const currentY = height - padding - (normalizedCurrent * chartHeight);
            
            // Pulsing circle
            const pulseSize = 8 + Math.sin(Date.now() / 200) * 2;
            ctx.beginPath();
            ctx.arc(points[points.length - 1].x, currentY, pulseSize, 0, Math.PI * 2);
            ctx.fillStyle = currentPrice > gameState.roundStartPrice ? '#10b981' : '#ef4444';
            ctx.shadowBlur = 20;
            ctx.shadowColor = currentPrice > gameState.roundStartPrice ? '#10b981' : '#ef4444';
            ctx.fill();
            ctx.shadowBlur = 0;
            
            // Current price label
            const bgColor = currentPrice > gameState.roundStartPrice ? 'rgba(16, 185, 129, 0.9)' : 'rgba(239, 68, 68, 0.9)';
            ctx.fillStyle = bgColor;
            const currentLabelWidth = 120;
            ctx.fillRect(width - padding - currentLabelWidth - 5, currentY - 20, currentLabelWidth, 18);
            ctx.fillStyle = 'white';
            ctx.font = 'bold 12px Inter';
            ctx.textAlign = 'left';
            ctx.fillText(`Now: $${currentPrice.toFixed(4)}`, width - padding - currentLabelWidth, currentY - 7);
        }
    }
    
    gameState.animationFrame = requestAnimationFrame(animateChart);
}

// Connect to Binance WebSocket
function connectBinance() {
    ws = new WebSocket(BINANCE_WS);
    
    ws.onopen = () => {
        console.log('🟢 Connected to Binance');
        showNotification('Connected to live market data', 'success');
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        const price = parseFloat(data.p);
        updatePrice(price);
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        showNotification('Connection error, retrying...', 'error');
    };
    
    ws.onclose = () => {
        console.log('🔴 Disconnected from Binance, reconnecting...');
        setTimeout(connectBinance, 3000);
    };
}

// Update price display with advanced effects
function updatePrice(price) {
    const oldPrice = gameState.currentPrice;
    gameState.currentPrice = price;
    
    // Only add to chart during trading phase
    if (gameState.roundPhase === 'trading') {
        gameState.chartData.push({
            price: price,
            timestamp: Date.now()
        });
    }
}

// Show notification
function showNotification(message, type = 'info') {
    // Simple console notification for now
    console.log(`[${type.toUpperCase()}] ${message}`);
}

// Add button hover effects
function addButtonEffects() {
    const buttons = document.querySelectorAll('.prediction-buttons .btn');
    buttons.forEach(btn => {
        btn.classList.add('pulse');
    });
}

// Automatic round system
function startAutomaticRounds() {
    startNewRound();
}

function startNewRound() {
    // Reset prediction
    gameState.prediction = null;
    gameState.canPredict = true;
    gameState.roundPhase = 'waiting';
    gameState.timer = 5;
    gameState.roundStartPrice = 0;
    
    // Don't clear chart yet - will clear when trading phase starts
    
    // Enable buttons
    document.getElementById('btnUp').disabled = false;
    document.getElementById('btnDown').disabled = false;
    addButtonEffects();
    
    // Hide prediction badge
    document.getElementById('predictionBadge').classList.remove('active');
    
    // Update UI
    document.getElementById('gameStatus').innerHTML = '<p>⏰ New round starting! Make your prediction in 5 seconds...</p>';
    document.getElementById('timerValue').textContent = '5';
    
    // Show game UI
    document.getElementById('predictionButtons').style.display = 'grid';
    document.getElementById('gameStatus').style.display = 'block';
    document.querySelector('.timer-container').style.display = 'flex';
    document.getElementById('resultDisplay').style.display = 'none';
    
    playSound('start');
    
    // Start waiting phase countdown
    startWaitingPhase();
}

function startWaitingPhase() {
    const timerEl = document.getElementById('timerValue');
    const timerContainer = document.getElementById('timer');
    timerContainer.classList.remove('urgent');
    
    gameState.roundTimer = setInterval(() => {
        gameState.timer--;
        timerEl.textContent = gameState.timer;
        
        if (gameState.timer <= 3) {
            timerContainer.classList.add('urgent');
            playSound('tick');
        }
        
        if (gameState.timer <= 0) {
            clearInterval(gameState.roundTimer);
            timerContainer.classList.remove('urgent');
            startTradingPhase();
        }
    }, 1000);
}

function startTradingPhase() {
    gameState.roundPhase = 'trading';
    gameState.timer = 10;
    gameState.canPredict = false;
    
    // Lock the start price and clear chart for this round only
    gameState.roundStartPrice = gameState.currentPrice;
    gameState.chartData = [{price: gameState.roundStartPrice, timestamp: Date.now()}];
    
    // Disable buttons
    document.getElementById('btnUp').disabled = true;
    document.getElementById('btnDown').disabled = true;
    document.querySelectorAll('.prediction-buttons .btn').forEach(btn => {
        btn.classList.remove('pulse');
    });
    
    // Update status
    const statusEl = document.getElementById('gameStatus');
    if (gameState.prediction) {
        statusEl.innerHTML = `<p>📊 Round in progress... | Entry: <strong>$${gameState.roundStartPrice.toFixed(4)}</strong> | Your bet: <strong>${gameState.prediction === 'up' ? '↑ LONG' : '↓ SHORT'}</strong></p>`;
    } else {
        statusEl.innerHTML = `<p>⏭️ You didn't place a bet this round | Watching: <strong>$${gameState.roundStartPrice.toFixed(4)}</strong></p>`;
    }
    
    const timerEl = document.getElementById('timerValue');
    timerEl.textContent = '10';
    
    // Trading phase countdown
    gameState.roundTimer = setInterval(() => {
        gameState.timer--;
        timerEl.textContent = gameState.timer;
        
        // Update live P&L if user made prediction
        if (gameState.prediction) {
            const currentDiff = gameState.currentPrice - gameState.roundStartPrice;
            const currentChange = ((currentDiff / gameState.roundStartPrice) * 100).toFixed(3);
            const arrow = currentDiff >= 0 ? '📈' : '📉';
            const pnl = currentDiff >= 0 ? '+' : '';
            
            statusEl.innerHTML = `<p>${arrow} Live: <strong>$${gameState.currentPrice.toFixed(4)}</strong> | P&L: <strong class="${currentDiff >= 0 ? 'positive' : 'negative'}">${pnl}${currentChange}%</strong></p>`;
        }
        
        if (gameState.timer <= 3) {
            playSound('tick');
        }
        
        if (gameState.timer <= 0) {
            clearInterval(gameState.roundTimer);
            endRound();
        }
    }, 1000);
}

function endRound() {
    gameState.roundPhase = 'result';
    gameState.roundEndPrice = gameState.currentPrice;
    
    const priceDiff = gameState.roundEndPrice - gameState.roundStartPrice;
    const changePercent = ((priceDiff / gameState.roundStartPrice) * 100).toFixed(3);
    
    let won = false;
    let participated = false;
    
    // Check if user made a prediction
    if (gameState.prediction) {
        participated = true;
        gameState.totalGames++;
        
        if (gameState.prediction === 'up' && priceDiff > 0) {
            won = true;
            gameState.score++;
            gameState.wins++;
            
            // Add points to PlayFun SDK and save immediately
            if (sdkReady && sdk) {
                try {
                    sdk.addPoints(1); // Add 1 point for winning
                    console.log('✅ Added 1 point (local)');
                    
                    // Save immediately after winning
                    savePointsToPlayFun();
                } catch (error) {
                    console.error('❌ Error adding points:', error);
                }
            }
        } else if (gameState.prediction === 'down' && priceDiff < 0) {
            won = true;
            gameState.score++;
            gameState.wins++;
            
            // Add points to PlayFun SDK and save immediately
            if (sdkReady && sdk) {
                try {
                    sdk.addPoints(1); // Add 1 point for winning
                    console.log('✅ Added 1 point (local)');
                    
                    // Save immediately after winning
                    savePointsToPlayFun();
                } catch (error) {
                    console.error('❌ Error adding points:', error);
                }
            }
        }
        
        // Update scores
        animateValue('score', gameState.score);
        animateValue('totalGames', gameState.totalGames);
        const winRate = ((gameState.wins / gameState.totalGames) * 100).toFixed(1);
        document.getElementById('winRate').textContent = `${winRate}%`;
    }
    
    // Show result
    showRoundResult(participated, won, priceDiff, changePercent);
}

// Save accumulated points to PlayFun (called on page unload)
async function savePointsToPlayFun() {
    if (!sdkReady || !sdk) {
        console.log('⚠️ PlayFun SDK not ready');
        return;
    }
    
    try {
        console.log('💾 Saving accumulated points to PlayFun...');
        await sdk.endGame(); // This saves all accumulated points
        console.log('✅ Points saved to PlayFun!');
    } catch (error) {
        console.error('❌ Error saving points to PlayFun:', error);
    }
}

function showRoundResult(participated, won, priceDiff, changePercent) {
    const resultDisplay = document.getElementById('resultDisplay');
    const resultContent = resultDisplay.querySelector('.result-content');
    const resultTitle = document.getElementById('resultTitle');
    const resultMessage = document.getElementById('resultMessage');
    const resultAnimation = document.getElementById('resultAnimation');
    
    const arrow = priceDiff >= 0 ? '📈' : '📉';
    const direction = priceDiff >= 0 ? 'UP' : 'DOWN';
    
    if (!participated) {
        // User didn't participate
        resultContent.className = 'result-content';
        resultTitle.textContent = '⏭️ Round Ended';
        resultAnimation.textContent = '👀';
        resultMessage.innerHTML = `
            <strong style="font-size: 1.4em;">You didn't place a bet</strong><br><br>
            Start Price: <strong>$${gameState.roundStartPrice.toFixed(4)}</strong><br>
            End Price: <strong>$${gameState.roundEndPrice.toFixed(4)}</strong><br>
            Result: <strong style="color: ${priceDiff >= 0 ? '#10b981' : '#ef4444'}">${arrow} ${direction} ${priceDiff >= 0 ? '+' : ''}${changePercent}%</strong><br>
            <br>Next round starting in 3 seconds...
        `;
    } else if (won) {
        // User won
        resultContent.className = 'result-content win';
        resultTitle.textContent = '🎉 WINNER!';
        resultAnimation.textContent = '🏆';
        resultMessage.innerHTML = `
            <strong style="font-size: 1.4em; color: #10b981;">+2.00x Profit!</strong><br><br>
            Entry: <strong>$${gameState.roundStartPrice.toFixed(4)}</strong><br>
            Exit: <strong>$${gameState.roundEndPrice.toFixed(4)}</strong><br>
            Result: <strong style="color: ${priceDiff >= 0 ? '#10b981' : '#ef4444'}">${arrow} ${direction} ${priceDiff >= 0 ? '+' : ''}${changePercent}%</strong><br>
            <br>💰 <strong>+1 Point Earned!</strong><br>
            Next round in 3 seconds...
        `;
        
        launchConfetti();
        playSound('win');
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    } else {
        // User lost
        resultContent.className = 'result-content lose';
        resultTitle.textContent = '💔 LIQUIDATED';
        resultAnimation.textContent = '📉';
        resultMessage.innerHTML = `
            <strong style="font-size: 1.4em; color: #ef4444;">Position Closed</strong><br><br>
            Entry: <strong>$${gameState.roundStartPrice.toFixed(4)}</strong><br>
            Exit: <strong>$${gameState.roundEndPrice.toFixed(4)}</strong><br>
            Result: <strong style="color: ${priceDiff >= 0 ? '#10b981' : '#ef4444'}">${arrow} ${direction} ${priceDiff >= 0 ? '+' : ''}${changePercent}%</strong><br>
            <br>Better luck next round!<br>
            Next round in 3 seconds...
        `;
        
        playSound('lose');
        if (navigator.vibrate) navigator.vibrate(200);
    }
    
    // Hide prediction badge
    document.getElementById('predictionBadge').classList.remove('active');
    
    // Show result
    document.getElementById('predictionButtons').style.display = 'none';
    document.getElementById('gameStatus').style.display = 'none';
    document.querySelector('.timer-container').style.display = 'none';
    resultDisplay.style.display = 'block';
    
    // Auto start next round after 3 seconds
    setTimeout(() => {
        startNewRound();
    }, 3000);
}

// Make prediction (only during waiting phase)
function makePrediction(direction) {
    if (!gameState.canPredict || gameState.roundPhase !== 'waiting') {
        return;
    }
    
    gameState.prediction = direction;
    gameState.canPredict = false;
    
    // Show prediction badge
    const badge = document.getElementById('predictionBadge');
    badge.className = `prediction-badge active ${direction}`;
    badge.innerHTML = `<span>${direction === 'up' ? '↑ LONG' : '↓ SHORT'}</span>`;
    
    // Update status
    const statusEl = document.getElementById('gameStatus');
    statusEl.innerHTML = `<p>✅ Prediction locked: <strong>${direction === 'up' ? '↑ LONG' : '↓ SHORT'}</strong> | Waiting for round to start...</p>`;
    
    // Disable buttons after prediction
    document.getElementById('btnUp').disabled = true;
    document.getElementById('btnDown').disabled = true;
    document.querySelectorAll('.prediction-buttons .btn').forEach(btn => {
        btn.classList.remove('pulse');
    });
    
    playSound('start');
    if (navigator.vibrate) navigator.vibrate(50);
}



// Animate number changes
function animateValue(elementId, endValue) {
    const element = document.getElementById(elementId);
    const startValue = parseInt(element.textContent) || 0;
    const duration = 500;
    const startTime = performance.now();
    
    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const currentValue = Math.floor(startValue + (endValue - startValue) * progress);
        element.textContent = currentValue;
        
        if (progress < 1) {
            requestAnimationFrame(update);
        }
    }
    
    requestAnimationFrame(update);
}



// Advanced confetti effect
function launchConfetti() {
    const canvas = document.getElementById('confetti');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    const confetti = [];
    const colors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
    const shapes = ['circle', 'square', 'triangle'];
    
    for (let i = 0; i < 150; i++) {
        confetti.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height - canvas.height,
            r: Math.random() * 8 + 4,
            d: Math.random() * 10 + 5,
            color: colors[Math.floor(Math.random() * colors.length)],
            tilt: Math.random() * 10 - 5,
            tiltAngle: 0,
            tiltAngleIncrement: Math.random() * 0.1 + 0.05,
            shape: shapes[Math.floor(Math.random() * shapes.length)]
        });
    }
    
    function drawConfetti() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        confetti.forEach((c, i) => {
            ctx.save();
            ctx.translate(c.x, c.y);
            ctx.rotate(c.tiltAngle);
            
            ctx.fillStyle = c.color;
            
            if (c.shape === 'circle') {
                ctx.beginPath();
                ctx.arc(0, 0, c.r, 0, Math.PI * 2);
                ctx.fill();
            } else if (c.shape === 'square') {
                ctx.fillRect(-c.r, -c.r, c.r * 2, c.r * 2);
            } else if (c.shape === 'triangle') {
                ctx.beginPath();
                ctx.moveTo(0, -c.r);
                ctx.lineTo(c.r, c.r);
                ctx.lineTo(-c.r, c.r);
                ctx.closePath();
                ctx.fill();
            }
            
            ctx.restore();
            
            c.tiltAngle += c.tiltAngleIncrement;
            c.y += c.d;
            c.x += Math.sin(c.tiltAngle) * 2;
            
            if (c.y > canvas.height) {
                confetti.splice(i, 1);
            }
        });
        
        if (confetti.length > 0) {
            requestAnimationFrame(drawConfetti);
        } else {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }
    
    drawConfetti();
}

// Enhanced sound effects
function playSound(type) {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        if (type === 'win') {
            // Victory fanfare
            oscillator.frequency.setValueAtTime(523.25, audioContext.currentTime); // C5
            oscillator.frequency.setValueAtTime(659.25, audioContext.currentTime + 0.1); // E5
            oscillator.frequency.setValueAtTime(783.99, audioContext.currentTime + 0.2); // G5
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.5);
        } else if (type === 'lose') {
            // Descending tone
            oscillator.frequency.setValueAtTime(400, audioContext.currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(200, audioContext.currentTime + 0.3);
            gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.3);
        } else if (type === 'start') {
            // Quick beep
            oscillator.frequency.value = 800;
            gainNode.gain.setValueAtTime(0.15, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.1);
        } else if (type === 'tick') {
            // Subtle tick
            oscillator.frequency.value = 1000;
            gainNode.gain.setValueAtTime(0.05, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.05);
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.05);
        }
    } catch (e) {
        console.log('Audio not supported');
    }
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    // Save accumulated points before leaving
    if (sdkReady && sdk && gameState.score > 0) {
        try {
            // Use sendBeacon for reliable background save
            sdk.endGame().catch(err => console.error('Error saving on exit:', err));
        } catch (error) {
            console.error('Error on cleanup:', error);
        }
    }
    
    if (ws) {
        ws.close();
    }
    if (gameState.animationFrame) {
        cancelAnimationFrame(gameState.animationFrame);
    }
    if (gameState.roundTimer) {
        clearInterval(gameState.roundTimer);
    }
});

// Handle window resize
window.addEventListener('resize', () => {
    if (gameState.ctx) {
        const canvas = document.getElementById('priceChart');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        gameState.ctx.scale(dpr, dpr);
        canvas.style.width = rect.width + 'px';
        canvas.style.height = rect.height + 'px';
    }
});
