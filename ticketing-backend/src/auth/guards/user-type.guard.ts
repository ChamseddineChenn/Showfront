import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { USER_TYPES_KEY } from '../decorators/user-types.decorator';
import { UserType } from '../../users/enums/user-type.enum';

export interface RequestUser {
  userId: string;
  email: string;
  userType: string;
}

@Injectable()
export class UserTypeGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredTypes = this.reflector.getAllAndOverride<UserType[]>(
      USER_TYPES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no types required, allow access
    if (!requiredTypes || requiredTypes.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as RequestUser;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    // ADMINS CAN ACCESS EVERYTHING
    if (user.userType === UserType.ADMIN.toString()) {
      return true;
    }

    const hasType = requiredTypes.some(
      (type) => user.userType === type.toString(),
    );

    if (!hasType) {
      throw new ForbiddenException(
        `Access denied. Required user type: ${requiredTypes.join(' or ')}`,
      );
    }

    return true;
  }
}
