import { Test, TestingModule } from '@nestjs/testing';
import { Neo4jController } from './neo4j.controller';

describe('Neo4jController', () => {
  let controller: Neo4jController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [Neo4jController],
    }).compile();

    controller = module.get<Neo4jController>(Neo4jController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
