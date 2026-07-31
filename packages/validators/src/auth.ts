import { z } from 'zod';
import { emailSchema, idSchema, requiredText, userRoleSchema } from './common';

const passwordSchema = z
  .string({
    required_error: 'La contraseña es obligatoria',
    invalid_type_error: 'La contraseña debe ser texto',
  })
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .max(128, 'La contraseña no puede exceder 128 caracteres');

export const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const registerSchema = loginSchema.extend({
  firstName: requiredText('El nombre', 100),
  lastName: requiredText('El apellido', 100),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  email: emailSchema,
  token: z
    .string({
      required_error: 'El token de recuperación es obligatorio',
      invalid_type_error: 'El token de recuperación debe ser texto',
    })
    .min(32, 'El token de recuperación no es válido')
    .max(256, 'El token de recuperación no es válido'),
  password: passwordSchema,
});

export const createUserSchema = registerSchema.extend({
  role: userRoleSchema,
});

export const updateUserSchema = z
  .object({
    firstName: requiredText('El nombre', 100).optional(),
    lastName: requiredText('El apellido', 100).optional(),
    email: emailSchema.optional(),
    role: userRoleSchema.optional(),
    active: z
      .boolean({ invalid_type_error: 'El estado activo debe ser verdadero o falso' })
      .optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Indica al menos un dato para actualizar',
  });

export const userIdParamsSchema = z.object({
  userId: idSchema,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UserIdParams = z.infer<typeof userIdParamsSchema>;
