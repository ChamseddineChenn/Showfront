import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private transporter: Transporter;
  private readonly logger = new Logger(MailService.name);

  constructor(private configService: ConfigService) {
    const mailHost =
      this.configService.get<string>('mail.host') || 'smtp.gmail.com';
    const mailPort = this.configService.get<number>('mail.port') || 587;
    const mailUser = this.configService.get<string>('mail.user');
    const mailPassword = this.configService.get<string>('mail.password');

    this.logger.log(
      `Initializing mail service with host: ${mailHost}:${mailPort}, user: ${mailUser ? '***configured***' : 'NOT SET'}`,
    );

    this.transporter = nodemailer.createTransport({
      host: mailHost,
      port: mailPort,
      secure: mailPort === 465, // true for 465, false for other ports like 587
      auth: {
        user: mailUser,
        pass: mailPassword,
      },
      connectionTimeout: 15000, // 15 seconds - longer timeout for Render
      socketTimeout: 15000, // 15 seconds
      // TLS options for Gmail compatibility on Render
      tls: {
        rejectUnauthorized: false, // Allow self-signed certs
        minVersion: 'TLSv1.2',
      },
      logger: true,
      debug: process.env.NODE_ENV !== 'production',
    });
  }

  /**
   * Event listener for email verification
   * Triggered when user signs up or updates email
   */
  @OnEvent('user.emailVerificationNeeded')
  async handleEmailVerificationEvent(payload: {
    email: string;
    token: string;
    userId: string;
  }) {
    try {
      await this.sendVerificationEmail(payload.email, payload.token);
      this.logger.log(`Email verification sent for user ${payload.userId}`);
    } catch (error) {
      this.logger.error(
        `Failed to send verification email for user ${payload.userId}:`,
        error,
      );
    }
  }

  /**
   * Event listener for password reset
   */
  @OnEvent('user.passwordResetRequested')
  async handlePasswordResetEvent(payload: {
    email: string;
    token: string;
    userId: string;
  }) {
    try {
      await this.sendPasswordResetEmail(payload.email, payload.token);
      this.logger.log(`Password reset email sent for user ${payload.userId}`);
    } catch (error) {
      this.logger.error(
        `Failed to send password reset email for user ${payload.userId}:`,
        error,
      );
    }
  }

  async sendVerificationEmail(email: string, token: string): Promise<void> {
    const frontendUrl = this.configService.get<string>('cors.origin');
    const verificationUrl = `${frontendUrl}/auth/verify-email?token=${token}`;

    const mailOptions = {
      from: this.configService.get<string>('mail.from'),
      to: email,
      subject: '✨ Verify Your Showfront Account',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
            .button { display: inline-block; padding: 15px 30px; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
            .footer { text-align: center; margin-top: 30px; color: #6b7280; font-size: 14px; }
            .code { background: #fff; border: 2px dashed #f59e0b; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; margin: 20px 0; border-radius: 8px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🎉 Welcome to Showfront!</h1>
            </div>
            <div class="content">
              <p>Hi there,</p>
              <p>Thank you for signing up! We're excited to have you join our community of event enthusiasts.</p>
              <p>To get started, please verify your email address by clicking the button below:</p>
              <div style="text-align: center;">
                <a href="${verificationUrl}" class="button">Verify Email Address</a>
              </div>
              <p>Or copy and paste this link into your browser:</p>
              <p style="word-break: break-all; color: #f59e0b;">${verificationUrl}</p>
              <p><strong>This link will expire in 24 hours.</strong></p>
              <p>If you didn't create an account with Showfront, please ignore this email.</p>
            </div>
            <div class="footer">
              <p>Showfront Events © 2026</p>
              <p>Tunis, Tunisia</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    try {
      await this.sendMailWithRetry(mailOptions);
    } catch (error) {
      this.logger.error(
        `Failed to send verification email to ${email}:`,
        error,
      );
      throw error;
    }
  }

  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    const frontendUrl = this.configService.get<string>('cors.origin');
    const resetUrl = `${frontendUrl}/auth/reset-password?token=${token}`;

    const mailOptions = {
      from: this.configService.get<string>('mail.from'),
      to: email,
      subject: '🔒 Reset Your Showfront Password',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
            .button { display: inline-block; padding: 15px 30px; background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
            .footer { text-align: center; margin-top: 30px; color: #6b7280; font-size: 14px; }
            .warning { background: #fef2f2; border-left: 4px solid #ef4444; padding: 15px; margin: 20px 0; border-radius: 4px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔒 Password Reset Request</h1>
            </div>
            <div class="content">
              <p>Hi there,</p>
              <p>We received a request to reset your password for your Showfront account.</p>
              <p>Click the button below to reset your password:</p>
              <div style="text-align: center;">
                <a href="${resetUrl}" class="button">Reset Password</a>
              </div>
              <p>Or copy and paste this link into your browser:</p>
              <p style="word-break: break-all; color: #1e293b;">${resetUrl}</p>
              <p><strong>This link will expire in 1 hour.</strong></p>
              <div class="warning">
                <strong>⚠️ Security Notice:</strong> If you didn't request a password reset, please ignore this email. Your password will remain unchanged.
              </div>
            </div>
            <div class="footer">
              <p>Showfront Events © 2026</p>
              <p>Tunis, Tunisia</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    try {
      await this.sendMailWithRetry(mailOptions);
    } catch (error) {
      this.logger.error(
        `Failed to send password reset email to ${email}:`,
        error,
      );
      throw error;
    }
  }

  async sendPasswordResetConfirmation(email: string): Promise<void> {
    const mailOptions = {
      from: this.configService.get<string>('mail.from'),
      to: email,
      subject: '✅ Your Password Has Been Reset',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
            .footer { text-align: center; margin-top: 30px; color: #6b7280; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>✅ Password Reset Successful</h1>
            </div>
            <div class="content">
              <p>Hi there,</p>
              <p>Your password has been successfully reset. You can now log in with your new password.</p>
              <p>If you didn't make this change, please contact our support team immediately at <strong>support@showfront.events</strong></p>
            </div>
            <div class="footer">
              <p>Showfront Events © 2026</p>
              <p>Tunis, Tunisia</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    try {
      await this.sendMailWithRetry(mailOptions);
    } catch (error) {
      this.logger.error(
        `Failed to send confirmation email to ${email}:`,
        error,
      );
    }
  }

  /**
   * Send email verification for profile email updates
   */
  async sendEmailUpdateVerification(
    email: string,
    token: string,
  ): Promise<void> {
    const frontendUrl = this.configService.get<string>('cors.origin');
    const verificationUrl = `${frontendUrl}/auth/verify-email?token=${token}`;

    const mailOptions = {
      from: this.configService.get<string>('mail.from'),
      to: email,
      subject: '🔄 Verify Your New Email Address',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
            .button { display: inline-block; padding: 15px 30px; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
            .footer { text-align: center; margin-top: 30px; color: #6b7280; font-size: 14px; }
            .info-box { background: #eff6ff; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0; border-radius: 4px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔄 Email Address Update</h1>
            </div>
            <div class="content">
              <p>Hi there,</p>
              <p>You recently updated your email address for your Showfront account.</p>
              <div class="info-box">
                <strong>📧 New Email:</strong> ${email}
              </div>
              <p>To complete this change, please verify your new email address by clicking the button below:</p>
              <div style="text-align: center;">
                <a href="${verificationUrl}" class="button">Verify New Email</a>
              </div>
              <p>Or copy and paste this link into your browser:</p>
              <p style="word-break: break-all; color: #f59e0b;">${verificationUrl}</p>
              <p><strong>This link will expire in 24 hours.</strong></p>
              <p>If you didn't make this change, please contact our support team immediately at <strong>support@showfront.events</strong></p>
            </div>
            <div class="footer">
              <p>Showfront Events © 2026</p>
              <p>Tunis, Tunisia</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    try {
      await this.sendMailWithRetry(mailOptions);
    } catch (error) {
      this.logger.error(
        `Failed to send email update verification to ${email}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Send email with retry logic
   * Attempts to send email up to 3 times with exponential backoff
   */
  private async sendMailWithRetry(
    mailOptions: any,
    maxRetries: number = 3,
  ): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await this.transporter.sendMail(mailOptions);
        this.logger.log(
          `Email sent successfully to ${mailOptions.to} (attempt ${attempt + 1})`,
        );
        return; // Success - exit
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(
          `Failed to send email to ${mailOptions.to} (attempt ${attempt + 1}/${maxRetries}): ${lastError.message}`,
        );

        // If it's the last attempt, don't wait
        if (attempt < maxRetries - 1) {
          const delayMs = Math.pow(2, attempt) * 1000; // Exponential backoff: 1s, 2s, 4s
          this.logger.log(
            `Retrying email send in ${delayMs}ms... (attempt ${attempt + 2})`,
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    // All retries failed
    this.logger.error(
      `Failed to send email to ${mailOptions.to} after ${maxRetries} attempts: ${lastError?.message}`,
      lastError,
    );
    throw lastError;
  }
}
