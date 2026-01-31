import express, { Express } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { testConnection } from './services/database';
import { initializeSharePoint } from './services/sharepointService';
import { startPayrollScheduler } from './services/schedulerService';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import authRoutes from './routes/authRoutes';
import reportRoutes from './routes/reportRoutes';
import adminRoutes from './routes/adminRoutes';
import dashboardRoutes from './routes/dashboardRoutes';
import configRoutes from './routes/configRoutes';
import settingsRoutes from './routes/settingsRoutes';

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/config', configRoutes);
app.use('/api/settings', settingsRoutes);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

async function startServer() {
  try {
    // Test database connection
    await testConnection();

    // Initialize SharePoint (optional - skip if not configured)
    try {
      await initializeSharePoint();
    } catch (spError) {
      console.warn('⚠️  SharePoint integration skipped (not configured):', (spError as Error).message);
    }

    // Start payroll report scheduler
    startPayrollScheduler();
    
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📝 Auth routes available at http://localhost:${PORT}/api/auth`);
      console.log(`📋 Reports routes available at http://localhost:${PORT}/api/reports`);
      console.log(`⚙️  Admin routes available at http://localhost:${PORT}/api/admin`);
      console.log(`📊 Dashboard routes available at http://localhost:${PORT}/api/dashboard`);
      console.log(`☁️  SharePoint integration ready`);
      console.log(`⏰ Payroll scheduler active`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
