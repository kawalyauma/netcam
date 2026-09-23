import { Controller, Get, Param } from "@nestjs/common";
import { CustomersService } from "./customers.service";

@Controller("customers")
export class CustomersController {
  constructor(private readonly service: CustomersService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(":phoneNumber")
  findByPhone(@Param("phoneNumber") phoneNumber: string) {
    return this.service.findByPhone(phoneNumber);
  }
}
