import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../utils/database.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { cache } from '../utils/cache.js';

const memoryDb = db;

const analyticsRoutes: FastifyPluginAsync = async (fastify) => {
  // Get payments summary for a specific month
  fastify.get('/payments-summary', async (request: AuthenticatedRequest, reply) => {
    try {
      const { month, year } = request.query as { month?: string; year?: string };
      
      // Default to current month if not provided
      const now = new Date();
      const targetMonth = month ? parseInt(month, 10) - 1 : now.getMonth(); // month is 0-indexed
      const targetYear = year ? parseInt(year, 10) : now.getFullYear();
      
      // Validate month and year
      if (targetMonth < 0 || targetMonth > 11) {
        return reply.status(400).send({ error: 'Invalid month. Must be between 1 and 12' });
      }
      if (targetYear < 2000 || targetYear > 2100) {
        return reply.status(400).send({ error: 'Invalid year' });
      }
      
      // Check cache first (analytics can be cached for 1 minute)
      const cacheKey = `analytics:payments-summary:${targetMonth}:${targetYear}`;
      const cached = cache.get(cacheKey);
      if (cached) {
        return reply.send(cached);
      }

      // Get all clients
      const clients = await memoryDb.getClients();
      
      let totalAmount = 0;
      let paymentCount = 0;
      
      // Iterate through all clients and their payments
      for (const client of clients) {
        if (client.payment?.payments && Array.isArray(client.payment.payments)) {
          for (const payment of client.payment.payments) {
            if (payment && payment.date && payment.amount) {
              const paymentDate = new Date(payment.date);
              
              // Check if payment is in the target month and year
              if (
                paymentDate.getMonth() === targetMonth &&
                paymentDate.getFullYear() === targetYear
              ) {
                totalAmount += Number(payment.amount) || 0;
                paymentCount++;
              }
            }
          }
        }
      }
      
      const result = {
        totalAmount: totalAmount,
        paymentCount: paymentCount,
        month: targetMonth + 1, // Return 1-indexed month
        year: targetYear,
      };

      // Cache for 1 minute
      cache.set(cacheKey, result, 60 * 1000);
      
      return reply.send(result);
    } catch (error: any) {
      fastify.log.error('Error fetching payments summary:', error);
      return reply.status(500).send({ 
        error: error.message || 'Failed to fetch payments summary' 
      });
    }
  });

  // Get comprehensive monthly summary
  fastify.get('/monthly-summary', async (request: AuthenticatedRequest, reply) => {
    try {
      const { month, year } = request.query as { month?: string; year?: string };
      
      // Default to current month if not provided
      const now = new Date();
      const targetMonth = month ? parseInt(month, 10) - 1 : now.getMonth(); // month is 0-indexed
      const targetYear = year ? parseInt(year, 10) : now.getFullYear();
      
      // Validate month and year
      if (targetMonth < 0 || targetMonth > 11) {
        return reply.status(400).send({ error: 'Invalid month. Must be between 1 and 12' });
      }
      if (targetYear < 2000 || targetYear > 2100) {
        return reply.status(400).send({ error: 'Invalid year' });
      }
      
      // Check cache first (monthly summary can be cached for 1 minute)
      const cacheKey = `analytics:monthly-summary:${targetMonth}:${targetYear}`;
      const cached = cache.get(cacheKey);
      if (cached) {
        return reply.send(cached);
      }

      // Get all clients
      const clients = await memoryDb.getClients();
      
      // Initialize counters
      const activeClientIds = new Set<string>();
      let totalPayments = 0;
      let totalPaymentReceived = 0;
      let totalAdvance = 0;
      let totalDueOutstanding = 0; // Outstanding amount (what's still due)
      const clientsWhoPaid = new Set<string>();
      
      // Iterate through all clients
      for (const client of clients) {
        if (!client.payment) {
          continue;
        }
        
        const totalFee = client.payment.totalFee || 0;
        const paidAmount = client.payment.paidAmount || 0;
        let runningPaidAmount = 0;
        let hasPaymentInMonth = false;
        
        // Check if client has payments in this month
        if (client.payment.payments && Array.isArray(client.payment.payments)) {
          // Process payments in chronological order
          const sortedPayments = [...client.payment.payments].sort((a, b) => {
            return new Date(a.date).getTime() - new Date(b.date).getTime();
          });
          
          for (const payment of sortedPayments) {
            if (!payment || !payment.date || !payment.amount) {
              continue;
            }
            
            const paymentDate = new Date(payment.date);
            
            // Check if payment is in the target month and year
            if (
              paymentDate.getMonth() === targetMonth &&
              paymentDate.getFullYear() === targetYear
            ) {
              hasPaymentInMonth = true;
              const paymentAmount = Number(payment.amount) || 0;
              
              // Count all payments
              totalPayments++;
              
              // Calculate what was due before this payment
              const dueBeforePayment = totalFee - runningPaidAmount;
              
              // Determine payment status and advance
              if (paymentAmount > 0) {
                // Payment received (status = 'paid')
                totalPaymentReceived += paymentAmount;
                clientsWhoPaid.add(client.id);
                
                // Check if this is an advance payment
                // Advance = payment made when already fully paid OR excess over due amount
                if (runningPaidAmount >= totalFee) {
                  // Client already fully paid, this is advance
                  totalAdvance += paymentAmount;
                } else if (paymentAmount > dueBeforePayment) {
                  // Payment exceeds due amount, excess is advance
                  const advanceAmount = paymentAmount - dueBeforePayment;
                  totalAdvance += advanceAmount;
                }
                
                runningPaidAmount += paymentAmount;
              }
            } else {
              // Payment not in target month, but update running total for advance calculation
              runningPaidAmount += Number(payment.amount) || 0;
            }
          }
        }
        
        // Calculate outstanding due for clients active in this month
        const createdDate = new Date(client.created_at);
        const isActiveInMonth = 
          (createdDate.getMonth() === targetMonth && createdDate.getFullYear() === targetYear) ||
          hasPaymentInMonth;
        
        if (isActiveInMonth) {
          activeClientIds.add(client.id);
          // Calculate outstanding amount (what's still due)
          const outstanding = totalFee - paidAmount;
          if (outstanding > 0) {
            totalDueOutstanding += outstanding;
          }
        }
      }
      
      // Total Revenue = Payment Received (which includes due payments + advance payments)
      const totalRevenue = totalPaymentReceived;
      
      const result = {
        totalClients: activeClientIds.size,
        totalPayments: totalPayments,
        totalPaymentReceived: totalPaymentReceived,
        totalAdvance: totalAdvance,
        totalDue: totalDueOutstanding, // Outstanding amount
        totalRevenue: totalRevenue, // Total revenue = Payment Received
        clientsWhoPaid: clientsWhoPaid.size,
        month: targetMonth + 1, // Return 1-indexed month
        year: targetYear,
      };

      // Cache for 1 minute
      cache.set(cacheKey, result, 60 * 1000);
      
      return reply.send(result);
    } catch (error: any) {
      fastify.log.error('Error fetching monthly summary:', error);
      return reply.status(500).send({ 
        error: error.message || 'Failed to fetch monthly summary' 
      });
    }
  });

  // Get monthly summary for multiple months (for trend charts)
  fastify.get('/monthly-trend', async (request: AuthenticatedRequest, reply) => {
    try {
      const { months = '6' } = request.query as { months?: string }; // Default to 6 months
      const numberOfMonths = parseInt(months, 10) || 6;
      
      if (numberOfMonths < 1 || numberOfMonths > 24) {
        return reply.status(400).send({ error: 'Number of months must be between 1 and 24' });
      }
      
      const now = new Date();
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();
      
      const trendData = [];
      
      // Get data for the last N months
      for (let i = numberOfMonths - 1; i >= 0; i--) {
        const targetDate = new Date(currentYear, currentMonth - i, 1);
        const targetMonth = targetDate.getMonth();
        const targetYear = targetDate.getFullYear();
        
        // Get all clients
        const clients = await memoryDb.getClients();
        
        // Initialize counters
        let totalRevenue = 0;
        let totalAdvance = 0;
        let totalDueOutstanding = 0;
        let totalClients = 0;
        let clientsWhoPaid = 0;
        
        // Iterate through all clients
        for (const client of clients) {
          if (!client.payment) {
            continue;
          }
          
          const totalFee = client.payment.totalFee || 0;
          const paidAmount = client.payment.paidAmount || 0;
          let runningPaidAmount = 0;
          let hasPaymentInMonth = false;
          let clientPaidInMonth = false;
          
          // Check if client has payments in this month
          if (client.payment.payments && Array.isArray(client.payment.payments)) {
            const sortedPayments = [...client.payment.payments].sort((a, b) => {
              return new Date(a.date).getTime() - new Date(b.date).getTime();
            });
            
            for (const payment of sortedPayments) {
              if (!payment || !payment.date || !payment.amount) {
                continue;
              }
              
              const paymentDate = new Date(payment.date);
              
              if (
                paymentDate.getMonth() === targetMonth &&
                paymentDate.getFullYear() === targetYear
              ) {
                hasPaymentInMonth = true;
                const paymentAmount = Number(payment.amount) || 0;
                
                if (paymentAmount > 0) {
                  totalRevenue += paymentAmount;
                  if (!clientPaidInMonth) {
                    clientsWhoPaid++;
                    clientPaidInMonth = true;
                  }
                  
                  const dueBeforePayment = totalFee - runningPaidAmount;
                  if (runningPaidAmount >= totalFee) {
                    totalAdvance += paymentAmount;
                  } else if (paymentAmount > dueBeforePayment) {
                    const advanceAmount = paymentAmount - dueBeforePayment;
                    totalAdvance += advanceAmount;
                  }
                  
                  runningPaidAmount += paymentAmount;
                }
              } else {
                runningPaidAmount += Number(payment.amount) || 0;
              }
            }
          }
          
          // Check if client is active in this month
          const createdDate = new Date(client.created_at);
          const isActiveInMonth = 
            (createdDate.getMonth() === targetMonth && createdDate.getFullYear() === targetYear) ||
            hasPaymentInMonth;
        
          if (isActiveInMonth) {
            totalClients++;
            const outstanding = totalFee - paidAmount;
            if (outstanding > 0) {
              totalDueOutstanding += outstanding;
            }
          }
        }
        
        trendData.push({
          month: targetMonth + 1,
          year: targetYear,
          monthName: targetDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          totalRevenue,
          totalAdvance,
          totalDue: totalDueOutstanding,
          totalClients,
          clientsWhoPaid,
        });
      }
      
      return reply.send({ data: trendData });
    } catch (error: any) {
      fastify.log.error('Error fetching monthly trend:', error);
      return reply.status(500).send({ 
        error: error.message || 'Failed to fetch monthly trend' 
      });
    }
  });
};

export default analyticsRoutes;

