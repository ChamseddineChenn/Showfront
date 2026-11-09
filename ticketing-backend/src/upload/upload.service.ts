import { Injectable, BadRequestException, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';
import { AppLogger } from '../common/utils/logger';
import { CloudinaryUploadException } from '../common/exceptions/custom-exceptions';

@Injectable()
export class UploadService {
  private readonly logger = new AppLogger(UploadService.name);

  constructor(private readonly configService: ConfigService) {
    // Configure Cloudinary with API credentials from environment
    cloudinary.config({
      cloud_name: this.configService.get<string>('cloudinary.cloudName'),
      api_key: this.configService.get<string>('cloudinary.apiKey'),
      api_secret: this.configService.get<string>('cloudinary.apiSecret'),
    });

    this.logger.log('Cloudinary configured', UploadService.name);
  }

  async uploadImage(
    file: Express.Multer.File,
  ): Promise<{ secure_url: string; public_id: string }> {
    if (!file) {
      this.logger.warn('No file provided for upload', UploadService.name);
      throw new BadRequestException('No file provided');
    }

    // Validate file is an image
    if (!file.mimetype.startsWith('image/')) {
      this.logger.warn(
        `Invalid file type: ${file.mimetype}`,
        UploadService.name,
      );
      throw new BadRequestException('File must be an image');
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      this.logger.warn(
        `File size exceeds limit: ${file.size}`,
        UploadService.name,
      );
      throw new BadRequestException('File size must not exceed 5MB');
    }

    try {
      this.logger.log(
        `Uploading image: ${file.originalname}`,
        UploadService.name,
      );

      // Upload to Cloudinary using buffer
      const result = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: 'showfront/events', // Organize uploads in folder
            resource_type: 'auto',
          },
          (error, result) => {
            if (error) {
              reject(error);
            } else {
              resolve(result);
            }
          },
        );

        // Convert buffer to stream and pipe to Cloudinary
        const stream = Readable.from(file.buffer);
        stream.pipe(uploadStream);
      });

      const uploadResult = result as any;
      this.logger.log(
        `Image uploaded successfully: ${uploadResult.public_id}`,
        UploadService.name,
      );

      return {
        secure_url: uploadResult.secure_url,
        public_id: uploadResult.public_id,
      };
    } catch (error) {
      this.logger.error(
        'Cloudinary upload error',
        UploadService.name,
        error.message,
      );
      throw new CloudinaryUploadException(error.message);
    }
  }

  async deleteImage(publicId: string): Promise<void> {
    try {
      await cloudinary.uploader.destroy(publicId);
      this.logger.log(
        `Image deleted successfully: ${publicId}`,
        UploadService.name,
      );
    } catch (error) {
      this.logger.warn(
        `Error deleting image from Cloudinary: ${publicId}`,
        UploadService.name,
        error.message,
      );
      // Don't throw - deletion failure shouldn't block the operation
    }
  }
}
