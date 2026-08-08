import prisma from "../database/prisma";

export interface GuestCustomerInput {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
}

interface GuestUserResult {
  user: {
    id: string;
    email: string | null;
    name: string | null;
    phone: string | null;
    firebaseUId: string | null;
  };
  changed: boolean;
}

function normalize(value?: string | null): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function buildUserData(input: GuestCustomerInput): Record<string, string> {
  const data: Record<string, string> = {};
  const name = normalize(input.name);
  const phone = normalize(input.phone);
  const address = normalize(input.address);
  const city = normalize(input.city);
  const state = normalize(input.state);
  const zipCode = normalize(input.zipCode);

  if (name !== undefined) data.name = name;
  if (phone !== undefined) data.phone = phone;
  if (address !== undefined) data.address = address;
  if (city !== undefined) data.city = city;
  if (state !== undefined) data.state = state;
  if (zipCode !== undefined) data.zip_code = zipCode;

  return data;
}

class GuestUserService {
  isGuest(user: { firebaseUId?: string | null } | null | undefined): boolean {
    return !!user && !user.firebaseUId;
  }

  private baseSelect = {
    id: true,
    email: true,
    name: true,
    phone: true,
    firebaseUId: true,
  } as const;

  /**
   * Resolve (find-or-create) a guest user from customer data.
   * - email present + found guest -> update fields
   * - email present + found registered user (has firebaseUId) -> create a separate guest without copying email
   * - email present + not found -> create guest
   * - no email + existingUserId is a guest -> reuse it (update fields)
   * - no email + no reusable guest -> create anonymous guest
   */
  async resolveGuestUser(
    input: GuestCustomerInput,
    existingUserId?: string,
  ): Promise<GuestUserResult> {
    const email = normalize(input.email);

    // Existing guest identity is accepted only when a signed order capability
    // supplied its ID. Email alone is not proof of ownership.
    if (existingUserId) {
      const existingUser = await prisma.user.findUnique({
        where: { id: existingUserId },
        select: this.baseSelect,
      });

      if (existingUser && !existingUser.firebaseUId) {
        const emailOwner =
          email && email !== existingUser.email
            ? await prisma.user.findUnique({
                where: { email },
                select: { id: true },
              })
            : null;

        const updated = await prisma.user.update({
          where: { id: existingUser.id },
          // Keep a signed guest identity separate from an existing account or
          // another guest record that already owns this unique email.
          data: {
            ...buildUserData(input),
            ...(email && !emailOwner ? { email } : {}),
          },
          select: this.baseSelect,
        });
        return { user: updated, changed: false };
      }
    }

    if (email) {
      const existing = await prisma.user.findUnique({
        where: { email },
        select: this.baseSelect,
      });

      if (existing) {
        if (existing.firebaseUId) {
          const created = await prisma.user.create({
            data: buildUserData(input),
            select: this.baseSelect,
          });
          return { user: created, changed: true };
        }

        const pendingOrder = await prisma.order.findFirst({
          where: {
            user_id: existing.id,
            status: "PENDING",
            source: "customer",
          },
          select: { id: true },
        });
        if (pendingOrder) {
          const error: any = new Error(
            "Existe um pedido pendente para este contato. Use o mesmo navegador para continuar.",
          );
          error.code = "GUEST_ORDER_TOKEN_REQUIRED";
          throw error;
        }

        const updated = await prisma.user.update({
          where: { id: existing.id },
          data: buildUserData(input),
          select: this.baseSelect,
        });
        return { user: updated, changed: false };
      }
    }

    const created = await prisma.user.create({
      data: { ...buildUserData(input), ...(email ? { email } : {}) },
      select: this.baseSelect,
    });

    return { user: created, changed: true };
  }
}

export default new GuestUserService();
